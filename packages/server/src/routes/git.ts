import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify'

import type { PublicSpace } from '../db/space.types.js'
import { createAuditEvent } from '../services/audit/audit.js'
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

const gitAuthenticationChallenge =
  'Basic realm="Enspatium Git", charset="UTF-8"'

const GitTransportParamsSchema = Type.Object({
  namespaceSlug: Type.String({ minLength: 1, maxLength: 100 }),
  spaceSlug: Type.String({ minLength: 1, maxLength: 100 }),
})

const GitInfoRefsQuerySchema = Type.Object({
  service: Type.Union([
    Type.Literal('git-upload-pack'),
    Type.Literal('git-receive-pack'),
  ]),
})

interface GitAccess {
  space: Pick<PublicSpace, 'id' | 'namespaceId'>
  userId?: string
}

export const gitRoutes: FastifyPluginAsyncTypebox = async (app) => {
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

  reply.hijack()

  try {
    await serveGitHttpBackend({
      request: request.raw,
      response: reply.raw,
      dataRoot: app.config.DATA_ROOT,
      spaceId: access.space.id,
      service,
      servicePath,
      ...(access.userId ? { remoteUser: access.userId } : {}),
    })
  } catch (error) {
    request.log.error({ err: error }, 'Git HTTP backend failed')

    if (!reply.raw.headersSent) {
      reply.raw.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      reply.raw.end('Git HTTP backend failed\n')
      return
    }

    reply.raw.destroy(error instanceof Error ? error : undefined)
    return
  }

  if (servicePath === 'git-receive-pack' && access.userId) {
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
