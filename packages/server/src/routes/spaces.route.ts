import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'

import {
  addSpaceMember,
  createSpace,
  deleteSpace,
  getGitSpaceCommit,
  getGitSpaceDiff,
  getGitSpaceFile,
  getGitSpaceInfo,
  getGitSpaceReadme,
  getGitSpaceTags,
  getGitSpaceTree,
  getSpaceBySlug,
  listSpaceMembers,
  listSpaces,
  removeSpaceMember,
  updateSpace,
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
  GitDiffQuerySchema,
  GitDiffResponseSchema,
  GitFileQuerySchema,
  GitFileResponseSchema,
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

export const spaceRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    '/namespaces/:namespaceSlug/spaces',
    {
      schema: {
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
        params: SpaceParamsSchema,
        response: {
          200: SpaceResponseSchema,
        },
      },
    },
    async (request) => {
      return getSpaceBySlug(
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
    '/namespaces/:namespaceSlug/spaces/:spaceSlug/git/commit',
    {
      schema: {
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

  app.get(
    '/namespaces/:namespaceSlug/spaces/:spaceSlug/git/readme',
    {
      schema: {
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
    '/namespaces/:namespaceSlug/spaces/:spaceSlug',
    {
      schema: {
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

      return reply.code(204).send()
    },
  )

  app.post(
    '/namespaces/:namespaceSlug/spaces/:spaceSlug/members',
    {
      schema: {
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

      return reply.code(204).send()
    },
  )
}
