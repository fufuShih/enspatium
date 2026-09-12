import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'

import {
  addSpaceMember,
  createSpace,
  deleteSpace,
  getGitSpaceCommit,
  listGitSpaceCommits,
  getGitSpaceDiff,
  getGitSpaceFile,
  getGitSpaceFileInfo,
  openGitSpaceFile,
  openGitSpaceArchive,
  getGitSpaceInfo,
  getGitSpaceReadme,
  getGitSpaceTags,
  getGitSpaceTree,
  getReadableGitSpace,
  getSpaceDetails,
  listSpaceMembers,
  listSpaces,
  removeSpaceMember,
  updateSpace,
  updateGitSpaceDefaultBranch,
  updateSpaceMember,
} from '../services/space/space.js'
import {
  getCurrentUserId,
  requireCurrentUserId,
} from './current-user.route.js'
import {
  AddSpaceMemberBodySchema,
  CreateSpaceBodySchema,
  GitCommitDetailResponseSchema,
  GitCommitsQuerySchema,
  GitCommitPageResponseSchema,
  GitDiffQuerySchema,
  GitDiffResponseSchema,
  GitFileQuerySchema,
  GitFileResponseSchema,
  GitFileInfoResponseSchema,
  GitRawQuerySchema,
  GitReadmeResponseSchema,
  GitRefQuerySchema,
  GitRepositoryInfoResponseSchema,
  GitTagListResponseSchema,
  GitTreeQuerySchema,
  GitTreeResponseSchema,
  NamespaceParamsSchema,
  SpaceListResponseSchema,
  SpaceMemberListResponseSchema,
  SpaceMemberParamsSchema,
  SpaceMemberResponseSchema,
  SpaceParamsSchema,
  SpaceResponseSchema,
  UpdateSpaceBodySchema,
  UpdateSpaceMemberBodySchema,
} from './types/spaces.types.js'
import { sendGitContent } from './git-content.js'
import { requireSpaceStorage } from '../services/space/storage.js'
import { measureGitObjects } from '../services/git/receive-hook.js'
import { acquireGitProcess } from '../services/git/process.js'
import { join } from 'node:path'

export const spaceRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/namespaces/:namespaceSlug/spaces/:spaceSlug/git/storage', {
    schema: {
      operationId: 'getGitSpaceStorage', tags: ['spaces'], params: SpaceParamsSchema,
      response: { 200: Type.Object({
        usedBytes: Type.Integer({ minimum: 0 }),
        maxBytes: Type.Integer({ minimum: 1 }),
        maxPushBytes: Type.Integer({ minimum: 1 }),
      }) },
    },
  }, async (request, reply) => {
    const space = await getReadableGitSpace(app.db, getCurrentUserId(request), request.params.namespaceSlug, request.params.spaceSlug)
    const repository = await requireSpaceStorage(app.config.DATA_ROOT, space.id, 'git')
    const release = acquireGitProcess()
    try {
      reply.header('cache-control', 'private, no-store')
      return {
        usedBytes: await measureGitObjects(join(repository, 'objects')),
        maxBytes: app.config.GIT_REPOSITORY_MAX_BYTES,
        maxPushBytes: app.config.GIT_MAX_PUSH_BYTES,
      }
    } finally { release() }
  })

  app.post(
    '/namespaces/:namespaceSlug/spaces',
    {
      schema: {
        operationId: 'createSpace',
        tags: ['spaces'],
        params: NamespaceParamsSchema,
        body: CreateSpaceBodySchema,
        response: {
          201: SpaceResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const userId = requireCurrentUserId(request)
      const space = await createSpace(
        app.db,
        app.config.DATA_ROOT,
        userId,
        request.params.namespaceSlug,
        request.body,
      )

      return reply.code(201).send(space)
    },
  )

  app.get(
    '/namespaces/:namespaceSlug/spaces',
    {
      schema: {
        operationId: 'listSpaces',
        tags: ['spaces'],
        params: NamespaceParamsSchema,
        response: {
          200: SpaceListResponseSchema,
        },
      },
    },
    async (request) => {
      const userId = requireCurrentUserId(request)

      return listSpaces(app.db, userId, request.params.namespaceSlug)
    },
  )

  app.get(
    '/namespaces/:namespaceSlug/spaces/:spaceSlug',
    {
      schema: {
        operationId: 'getSpace',
        tags: ['spaces'],
        security: [{}, { session: [] }],
        params: SpaceParamsSchema,
        response: {
          200: Type.Object({ ...SpaceResponseSchema.properties, canDelete: Type.Boolean(), canManage: Type.Boolean() }),
        },
      },
    },
    async (request) => {
      return getSpaceDetails(
        app.db,
        getCurrentUserId(request),
        request.params.namespaceSlug,
        request.params.spaceSlug,
      )
    },
  )

  app.get(
    '/namespaces/:namespaceSlug/spaces/:spaceSlug/git',
    {
      schema: {
        operationId: 'getGitSpaceInfo',
        tags: ['spaces'],
        security: [{}, { session: [] }],
        params: SpaceParamsSchema,
        response: {
          200: GitRepositoryInfoResponseSchema,
        },
      },
    },
    async (request) => {
      return getGitSpaceInfo(
        app.db,
        app.config.DATA_ROOT,
        getCurrentUserId(request),
        request.params.namespaceSlug,
        request.params.spaceSlug,
      )
    },
  )

  app.get(
    '/namespaces/:namespaceSlug/spaces/:spaceSlug/git/tree',
    {
      schema: {
        operationId: 'getGitSpaceTree',
        tags: ['spaces'],
        security: [{}, { session: [] }],
        params: SpaceParamsSchema,
        querystring: GitTreeQuerySchema,
        response: {
          200: GitTreeResponseSchema,
        },
      },
    },
    async (request) => {
      return getGitSpaceTree(
        app.db,
        app.config.DATA_ROOT,
        getCurrentUserId(request),
        request.params.namespaceSlug,
        request.params.spaceSlug,
        request.query.ref,
        request.query.path,
      )
    },
  )

  app.get(
    '/namespaces/:namespaceSlug/spaces/:spaceSlug/git/tags',
    {
      schema: {
        operationId: 'getGitSpaceTags',
        tags: ['spaces'],
        security: [{}, { session: [] }],
        params: SpaceParamsSchema,
        response: {
          200: GitTagListResponseSchema,
        },
      },
    },
    async (request) => {
      return getGitSpaceTags(
        app.db,
        app.config.DATA_ROOT,
        getCurrentUserId(request),
        request.params.namespaceSlug,
        request.params.spaceSlug,
      )
    },
  )

  app.get(
    '/namespaces/:namespaceSlug/spaces/:spaceSlug/git/commits',
    {
      schema: {
        operationId: 'listGitSpaceCommits', tags: ['spaces'],
        security: [{}, { session: [] }], params: SpaceParamsSchema,
        querystring: GitCommitsQuerySchema,
        response: { 200: GitCommitPageResponseSchema },
      },
    },
    async request => listGitSpaceCommits(
      app.db, app.config.DATA_ROOT, getCurrentUserId(request),
      request.params.namespaceSlug, request.params.spaceSlug,
      request.query.ref, request.query.offset, request.query.limit,
    ),
  )

  app.get(
    '/namespaces/:namespaceSlug/spaces/:spaceSlug/git/commit',
    {
      schema: {
        operationId: 'getGitSpaceCommit',
        tags: ['spaces'],
        security: [{}, { session: [] }],
        params: SpaceParamsSchema,
        querystring: GitRefQuerySchema,
        response: {
          200: GitCommitDetailResponseSchema,
        },
      },
    },
    async (request) => {
      return getGitSpaceCommit(
        app.db,
        app.config.DATA_ROOT,
        getCurrentUserId(request),
        request.params.namespaceSlug,
        request.params.spaceSlug,
        request.query.ref,
      )
    },
  )

  app.get(
    '/namespaces/:namespaceSlug/spaces/:spaceSlug/git/diff',
    {
      schema: {
        operationId: 'getGitSpaceDiff',
        tags: ['spaces'],
        security: [{}, { session: [] }],
        params: SpaceParamsSchema,
        querystring: GitDiffQuerySchema,
        response: {
          200: GitDiffResponseSchema,
        },
      },
    },
    async (request) => {
      return getGitSpaceDiff(
        app.db,
        app.config.DATA_ROOT,
        getCurrentUserId(request),
        request.params.namespaceSlug,
        request.params.spaceSlug,
        request.query.from,
        request.query.to,
      )
    },
  )

  app.get(
    '/namespaces/:namespaceSlug/spaces/:spaceSlug/git/file',
    {
      schema: {
        operationId: 'getGitSpaceFile',
        tags: ['spaces'],
        security: [{}, { session: [] }],
        params: SpaceParamsSchema,
        querystring: GitFileQuerySchema,
        response: {
          200: GitFileResponseSchema,
        },
      },
    },
    async (request) => {
      return getGitSpaceFile(
        app.db,
        app.config.DATA_ROOT,
        getCurrentUserId(request),
        request.params.namespaceSlug,
        request.params.spaceSlug,
        request.query.ref,
        request.query.path,
      )
    },
  )

  app.get('/namespaces/:namespaceSlug/spaces/:spaceSlug/git/file-info', {
    schema: {
      operationId: 'getGitSpaceFileInfo', tags: ['spaces'], security: [{}, { session: [] }],
      params: SpaceParamsSchema, querystring: GitFileQuerySchema,
      response: { 200: GitFileInfoResponseSchema },
    },
  }, request => getGitSpaceFileInfo(
    app.db, app.config.DATA_ROOT, getCurrentUserId(request),
    request.params.namespaceSlug, request.params.spaceSlug, request.query.ref, request.query.path,
  ))

  for (const method of ['GET', 'HEAD'] as const) {
    app.route({
      method, url: '/namespaces/:namespaceSlug/spaces/:spaceSlug/git/raw',
      exposeHeadRoute: false, config: { swagger: { exposeHeadRoute: true } },
      schema: {
        operationId: 'getGitSpaceRawFile', tags: ['spaces'], security: [{}, { session: [] }],
        params: SpaceParamsSchema, querystring: GitRawQuerySchema,
      },
      handler: async (request, reply) => sendGitContent(request, reply, await openGitSpaceFile(
        app.db, app.config.DATA_ROOT, getCurrentUserId(request),
        request.params.namespaceSlug, request.params.spaceSlug, request.query.ref, request.query.path,
      ), request.query.download ?? false),
    })
  }

  for (const method of ['GET', 'HEAD'] as const) {
    app.route({
      method, url: '/namespaces/:namespaceSlug/spaces/:spaceSlug/git/archive',
      exposeHeadRoute: false, config: { swagger: { exposeHeadRoute: true } },
      schema: {
        operationId: 'downloadGitSpaceArchive', tags: ['spaces'], security: [{}, { session: [] }],
        params: SpaceParamsSchema, querystring: GitRefQuerySchema,
      },
      handler: async (request, reply) => sendGitContent(request, reply, await openGitSpaceArchive(
        app.db, app.config.DATA_ROOT, getCurrentUserId(request),
        request.params.namespaceSlug, request.params.spaceSlug, request.query.ref,
      ), true, 'application/zip'),
    })
  }

  app.get(
    '/namespaces/:namespaceSlug/spaces/:spaceSlug/git/readme',
    {
      schema: {
        operationId: 'getGitSpaceReadme',
        tags: ['spaces'],
        security: [{}, { session: [] }],
        params: SpaceParamsSchema,
        querystring: GitRefQuerySchema,
        response: {
          200: GitReadmeResponseSchema,
        },
      },
    },
    async (request) => {
      return getGitSpaceReadme(
        app.db,
        app.config.DATA_ROOT,
        getCurrentUserId(request),
        request.params.namespaceSlug,
        request.params.spaceSlug,
        request.query.ref,
      )
    },
  )

  app.patch(
    '/namespaces/:namespaceSlug/spaces/:spaceSlug/git/default-branch',
    {
      schema: {
        operationId: 'updateGitSpaceDefaultBranch',
        description: 'Owners only. Choose an existing branch as the clone/browse default. The current default branch is protected against deletion and non-fast-forward pushes. Returns 409 while storage writes or maintenance are active so protection cannot change during a push.',
        tags: ['spaces'],
        params: SpaceParamsSchema,
        body: Type.Object({ branch: Type.String({ minLength: 1, maxLength: 255 }) }, { additionalProperties: false }),
        response: { 200: Type.Object({ defaultBranch: Type.String() }) },
      },
    },
    async (request) => updateGitSpaceDefaultBranch(
      app.db,
      app.config.DATA_ROOT,
      requireCurrentUserId(request),
      request.params.namespaceSlug,
      request.params.spaceSlug,
      request.body.branch,
    ),
  )

  app.patch(
    '/namespaces/:namespaceSlug/spaces/:spaceSlug',
    {
      schema: {
        operationId: 'updateSpace',
        tags: ['spaces'],
        params: SpaceParamsSchema,
        body: UpdateSpaceBodySchema,
        response: {
          200: SpaceResponseSchema,
        },
      },
    },
    async (request) => {
      const userId = requireCurrentUserId(request)

      return updateSpace(
        app.db,
        userId,
        request.params.namespaceSlug,
        request.params.spaceSlug,
        request.body,
      )
    },
  )

  app.delete(
    '/namespaces/:namespaceSlug/spaces/:spaceSlug',
    {
      schema: {
        operationId: 'deleteSpace',
        tags: ['spaces'],
        response: { 204: Type.Null() },
        params: SpaceParamsSchema,
      },
    },
    async (request, reply) => {
      const userId = requireCurrentUserId(request)

      await deleteSpace(
        app.db,
        app.config.DATA_ROOT,
        userId,
        request.params.namespaceSlug,
        request.params.spaceSlug,
      )

      return reply.code(204).send(null)
    },
  )

  app.post(
    '/namespaces/:namespaceSlug/spaces/:spaceSlug/members',
    {
      schema: {
        operationId: 'addSpaceMember',
        tags: ['spaces'],
        params: SpaceParamsSchema,
        body: AddSpaceMemberBodySchema,
        response: {
          201: SpaceMemberResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const userId = requireCurrentUserId(request)
      const member = await addSpaceMember(
        app.db,
        userId,
        request.params.namespaceSlug,
        request.params.spaceSlug,
        request.body,
      )

      return reply.code(201).send(member)
    },
  )

  app.get(
    '/namespaces/:namespaceSlug/spaces/:spaceSlug/members',
    {
      schema: {
        operationId: 'listSpaceMembers',
        tags: ['spaces'],
        params: SpaceParamsSchema,
        response: {
          200: SpaceMemberListResponseSchema,
        },
      },
    },
    async (request) => {
      const userId = requireCurrentUserId(request)

      return listSpaceMembers(
        app.db,
        userId,
        request.params.namespaceSlug,
        request.params.spaceSlug,
      )
    },
  )

  app.patch(
    '/namespaces/:namespaceSlug/spaces/:spaceSlug/members/:userId',
    {
      schema: {
        operationId: 'updateSpaceMember',
        tags: ['spaces'],
        params: SpaceMemberParamsSchema,
        body: UpdateSpaceMemberBodySchema,
        response: {
          200: SpaceMemberResponseSchema,
        },
      },
    },
    async (request) => {
      const userId = requireCurrentUserId(request)

      return updateSpaceMember(
        app.db,
        userId,
        request.params.namespaceSlug,
        request.params.spaceSlug,
        request.params.userId,
        request.body,
      )
    },
  )

  app.delete(
    '/namespaces/:namespaceSlug/spaces/:spaceSlug/members/:userId',
    {
      schema: {
        operationId: 'removeSpaceMember',
        tags: ['spaces'],
        response: { 204: Type.Null() },
        params: SpaceMemberParamsSchema,
      },
    },
    async (request, reply) => {
      const userId = requireCurrentUserId(request)

      await removeSpaceMember(
        app.db,
        userId,
        request.params.namespaceSlug,
        request.params.spaceSlug,
        request.params.userId,
      )

      return reply.code(204).send(null)
    },
  )
}
