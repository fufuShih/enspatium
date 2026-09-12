import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify'

import { createAuditEvent } from '../services/audit/audit.js'
import { requireSpaceStorage } from '../services/space/storage.js'
import { acquireStorageWrite } from '../services/space/storage-access.js'
import { GitCapacityError } from '../services/git/process.js'
import { GitResourceError } from '../services/git/resources.js'
import {
  getReadableGitSpace,
  getWritableGitSpace,
  SpaceServiceError,
} from '../services/space/space.js'
import {
  serveGitHttpBackend,
  type GitHttpService,
  type GitHttpServicePath,
} from '../services/git/http.js'
import {
  authenticatePersonalAccessToken,
  TokenServiceError,
} from '../services/tokens.js'
import {
  GitInfoRefsQuerySchema,
  GitTransportParamsSchema,
  type GitAccess,
} from './types/git.types.js'

const gitAuthenticationChallenge =
  'Basic realm="Enspatium Git", charset="UTF-8"'

export const gitRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const throttle = app.rateLimit?.({ max: () => app.config.GIT_AUTH_RATE_LIMIT, timeWindow: '1 minute' })
  if (throttle) app.addHook('onRequest', throttle)
  app.addContentTypeParser(
    [
      'application/x-git-upload-pack-request',
      'application/x-git-receive-pack-request',
    ],
    (_request, _payload, done) => {
      done(null)
    },
  )

  app.get(
    '/git/:namespaceSlug/:spaceSlug.git/info/refs',
    {
      schema: {
        hide: true,
        params: GitTransportParamsSchema,
        querystring: GitInfoRefsQuerySchema,
      },
    },
    async (request, reply) => {
      await handleGitRequest(
        app,
        request,
        reply,
        request.params.namespaceSlug,
        request.params.spaceSlug,
        request.query.service,
        'info/refs',
      )
    },
  )

  app.post(
    '/git/:namespaceSlug/:spaceSlug.git/git-upload-pack',
    {
      schema: {
        hide: true,
        params: GitTransportParamsSchema,
      },
    },
    async (request, reply) => {
      await handleGitRequest(
        app,
        request,
        reply,
        request.params.namespaceSlug,
        request.params.spaceSlug,
        'git-upload-pack',
        'git-upload-pack',
      )
    },
  )

  app.post(
    '/git/:namespaceSlug/:spaceSlug.git/git-receive-pack',
    {
      schema: {
        hide: true,
        params: GitTransportParamsSchema,
      },
    },
    async (request, reply) => {
      await handleGitRequest(
        app,
        request,
        reply,
        request.params.namespaceSlug,
        request.params.spaceSlug,
        'git-receive-pack',
        'git-receive-pack',
      )
    },
  )
}

async function handleGitRequest(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  namespaceSlug: string,
  spaceSlug: string,
  service: GitHttpService,
  servicePath: GitHttpServicePath,
): Promise<void> {
  let access: GitAccess

  try {
    access =
      service === 'git-upload-pack'
        ? await getGitReadAccess(
            app,
            request.headers.authorization,
            namespaceSlug,
            spaceSlug,
          )
        : await getGitWriteAccess(
            app,
            request.headers.authorization,
            namespaceSlug,
            spaceSlug,
          )
  } catch (error) {
    if (isGitAuthenticationError(error)) {
      reply.header('www-authenticate', gitAuthenticationChallenge)
      await reply.code(401).type('text/plain').send('authentication required\n')
      return
    }

    throw error
  }

  // Acquire before hijacking so a busy response is a normal HTTP 409. Retain
  // the lease until the Git subprocess, HEAD synchronization and audit finish.
  const releaseWrite = servicePath === 'git-receive-pack' ? acquireStorageWrite(app.config.DATA_ROOT) : undefined
  try {
    await requireSpaceStorage(app.config.DATA_ROOT, access.space.id, 'git', service === 'git-receive-pack')
    reply.hijack()

    let refsChanged = false
    try {
      const result = await serveGitHttpBackend({
        request: request.raw,
        response: reply.raw,
        dataRoot: app.config.DATA_ROOT,
        spaceId: access.space.id,
        service,
        servicePath,
        limits: app.config,
        ...(access.userId ? { remoteUser: access.userId } : {}),
      })
      refsChanged = result.refsChanged
    } catch (error) {
      if ((error instanceof GitResourceError || error instanceof GitCapacityError) && !reply.raw.headersSent) {
        reply.raw.writeHead(error.statusCode, { 'content-type': 'text/plain; charset=utf-8', 'connection': 'close', 'retry-after': '5' })
        reply.raw.end(error.message + '\n')
        return
      }
      app.operations?.recordRequest(request, 502, 'git')
      request.log.error({ err: error }, 'Git HTTP backend failed')

      if (!reply.raw.headersSent) {
        reply.raw.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
        reply.raw.end('Git HTTP backend failed\n')
        return
      }

      reply.raw.destroy(error instanceof Error ? error : undefined)
      return
    }

    if (servicePath === 'git-receive-pack' && access.userId && refsChanged) {
      try {
        await createAuditEvent(app.db, {
          actorUserId: access.userId,
          namespaceId: access.space.namespaceId,
          spaceId: access.space.id,
          action: 'git.pushed',
          metadata: { transport: 'smart-http' },
        })
      } catch (error) {
        request.log.error({ err: error }, 'failed to create Git push audit event')
      }
    }
  } finally { releaseWrite?.() }
}

async function getGitReadAccess(
  app: FastifyInstance,
  authorization: string | undefined,
  namespaceSlug: string,
  spaceSlug: string,
): Promise<GitAccess> {
  try {
    const space = await getReadableGitSpace(
      app.db,
      undefined,
      namespaceSlug,
      spaceSlug,
    )

    return { space }
  } catch (error) {
    if (
      !(error instanceof SpaceServiceError) ||
      error.code !== 'UNAUTHENTICATED'
    ) {
      throw error
    }
  }

  const token = parseGitBasicToken(authorization)

  if (!token) {
    throw new TokenServiceError(
      'INVALID_TOKEN',
      401,
      'invalid personal access token',
    )
  }

  const authenticatedToken = await authenticatePersonalAccessToken(
    app.db,
    token,
    'git:read',
  )
  const space = await getReadableGitSpace(
    app.db,
    authenticatedToken.userId,
    namespaceSlug,
    spaceSlug,
  )

  return {
    space,
    userId: authenticatedToken.userId,
  }
}

async function getGitWriteAccess(
  app: FastifyInstance,
  authorization: string | undefined,
  namespaceSlug: string,
  spaceSlug: string,
): Promise<GitAccess> {
  const token = parseGitBasicToken(authorization)

  if (!token) {
    throw new TokenServiceError(
      'INVALID_TOKEN',
      401,
      'invalid personal access token',
    )
  }

  const authenticatedToken = await authenticatePersonalAccessToken(
    app.db,
    token,
    'git:write',
  )
  const space = await getWritableGitSpace(
    app.db,
    authenticatedToken.userId,
    namespaceSlug,
    spaceSlug,
  )

  return {
    space,
    userId: authenticatedToken.userId,
  }
}

export function parseGitBasicToken(
  authorization: string | undefined,
): string | undefined {
  if (!authorization?.toLowerCase().startsWith('basic ')) {
    return undefined
  }

  try {
    const credentials = Buffer.from(
      authorization.slice(6).trim(),
      'base64',
    ).toString('utf8')
    const separatorIndex = credentials.indexOf(':')

    if (separatorIndex < 0) {
      return undefined
    }

    const token = credentials.slice(separatorIndex + 1)

    return token || undefined
  } catch {
    return undefined
  }
}

function isGitAuthenticationError(error: unknown): boolean {
  return (
    (error instanceof SpaceServiceError &&
      error.code === 'UNAUTHENTICATED') ||
    (error instanceof TokenServiceError && error.code === 'INVALID_TOKEN')
  )
}
