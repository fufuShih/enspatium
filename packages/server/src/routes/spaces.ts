import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'

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
} from './current-user.js'

const NamespaceParamsSchema = Type.Object({
  namespaceSlug: Type.String({ minLength: 1, maxLength: 100 }),
})

const SpaceParamsSchema = Type.Object({
  namespaceSlug: Type.String({ minLength: 1, maxLength: 100 }),
  spaceSlug: Type.String({ minLength: 1, maxLength: 100 }),
})

const SpaceMemberParamsSchema = Type.Object({
  namespaceSlug: Type.String({ minLength: 1, maxLength: 100 }),
  spaceSlug: Type.String({ minLength: 1, maxLength: 100 }),
  userId: Type.String({ format: 'uuid' }),
})

const CreateSpaceBodySchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
  slug: Type.String({ minLength: 1, maxLength: 100 }),
  type: Type.Union([Type.Literal('git'), Type.Literal('object')]),
  visibility: Type.Optional(
    Type.Union([Type.Literal('public'), Type.Literal('private')]),
  ),
})

const UpdateSpaceBodySchema = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    visibility: Type.Optional(
      Type.Union([Type.Literal('public'), Type.Literal('private')]),
    ),
  },
  {
    additionalProperties: false,
    minProperties: 1,
  },
)

const AssignableSpaceMemberRoleSchema = Type.Union([
  Type.Literal('writer'),
  Type.Literal('reader'),
])

const AddSpaceMemberBodySchema = Type.Object({
  email: Type.String({ minLength: 1, maxLength: 320 }),
  role: AssignableSpaceMemberRoleSchema,
})

const UpdateSpaceMemberBodySchema = Type.Object({
  role: AssignableSpaceMemberRoleSchema,
})

const SpaceResponseSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  namespaceId: Type.String({ format: 'uuid' }),
  createdByUserId: Type.Union([
    Type.String({ format: 'uuid' }),
    Type.Null(),
  ]),
  name: Type.String(),
  slug: Type.String(),
  type: Type.Union([Type.Literal('git'), Type.Literal('object')]),
  visibility: Type.Union([
    Type.Literal('public'),
    Type.Literal('private'),
  ]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
})

const SpaceMemberResponseSchema = Type.Object({
  userId: Type.String({ format: 'uuid' }),
  email: Type.String(),
  displayName: Type.String(),
  role: Type.Union([
    Type.Literal('owner'),
    Type.Literal('writer'),
    Type.Literal('reader'),
  ]),
  joinedAt: Type.String(),
})

const GitCommitResponseSchema = Type.Object({
  id: Type.String({ pattern: '^[0-9a-f]{40,64}$' }),
  shortId: Type.String({ pattern: '^[0-9a-f]+$' }),
  authorName: Type.String(),
  authorEmail: Type.String(),
  authoredAt: Type.String({ format: 'date-time' }),
  message: Type.String(),
})

const GitRepositoryInfoResponseSchema = Type.Object({
  defaultBranch: Type.String(),
  branches: Type.Array(Type.String()),
  commits: Type.Array(GitCommitResponseSchema),
})

const GitRefQuerySchema = Type.Object({
  ref: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
})

const GitTreeQuerySchema = Type.Object({
  ref: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  path: Type.Optional(Type.String({ maxLength: 4096 })),
})

const GitFileQuerySchema = Type.Object({
  ref: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  path: Type.String({ minLength: 1, maxLength: 4096 }),
})

const GitDiffQuerySchema = Type.Object({
  from: Type.String({ minLength: 1, maxLength: 255 }),
  to: Type.String({ minLength: 1, maxLength: 255 }),
})

const GitTagResponseSchema = Type.Object({
  name: Type.String(),
  commitId: Type.String({ pattern: '^[0-9a-f]{40,64}$' }),
})

const GitCommitDetailResponseSchema = Type.Object({
  ref: Type.String(),
  id: Type.String({ pattern: '^[0-9a-f]{40,64}$' }),
  shortId: Type.String({ pattern: '^[0-9a-f]+$' }),
  parentIds: Type.Array(Type.String({ pattern: '^[0-9a-f]{40,64}$' })),
  authorName: Type.String(),
  authorEmail: Type.String(),
  authoredAt: Type.String({ format: 'date-time' }),
  committerName: Type.String(),
  committerEmail: Type.String(),
  committedAt: Type.String({ format: 'date-time' }),
  message: Type.String(),
})

const GitDiffRevisionResponseSchema = Type.Object({
  ref: Type.String(),
  commitId: Type.String({ pattern: '^[0-9a-f]{40,64}$' }),
})

const GitDiffResponseSchema = Type.Object({
  from: GitDiffRevisionResponseSchema,
  to: GitDiffRevisionResponseSchema,
  patch: Type.String(),
})

const GitTreeEntryResponseSchema = Type.Object({
  id: Type.String({ pattern: '^[0-9a-f]{40,64}$' }),
  name: Type.String(),
  path: Type.String(),
  type: Type.Union([
    Type.Literal('file'),
    Type.Literal('directory'),
    Type.Literal('symlink'),
    Type.Literal('submodule'),
  ]),
  size: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
})

const GitTreeResponseSchema = Type.Object({
  ref: Type.String(),
  commitId: Type.String({ pattern: '^[0-9a-f]{40,64}$' }),
  path: Type.String(),
  entries: Type.Array(GitTreeEntryResponseSchema),
})

const GitFileResponseSchema = Type.Object({
  ref: Type.String(),
  commitId: Type.String({ pattern: '^[0-9a-f]{40,64}$' }),
  path: Type.String(),
  name: Type.String(),
  size: Type.Integer({ minimum: 0 }),
  encoding: Type.Union([Type.Literal('utf-8'), Type.Literal('base64')]),
  content: Type.String(),
})

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
          200: Type.Array(SpaceResponseSchema),
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
          200: Type.Array(GitTagResponseSchema),
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
          200: Type.Union([GitFileResponseSchema, Type.Null()]),
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
          200: Type.Array(SpaceMemberResponseSchema),
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
