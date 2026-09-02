import { Type } from '@sinclair/typebox'

export const NamespaceParamsSchema = Type.Object({
  namespaceSlug: Type.String({ minLength: 1, maxLength: 100 }),
})

export const SpaceParamsSchema = Type.Object({
  namespaceSlug: Type.String({ minLength: 1, maxLength: 100 }),
  spaceSlug: Type.String({ minLength: 1, maxLength: 100 }),
})

export const SpaceMemberParamsSchema = Type.Object({
  namespaceSlug: Type.String({ minLength: 1, maxLength: 100 }),
  spaceSlug: Type.String({ minLength: 1, maxLength: 100 }),
  userId: Type.String({ format: 'uuid' }),
})

export const CreateSpaceBodySchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
  slug: Type.String({ minLength: 1, maxLength: 100 }),
  type: Type.Union([Type.Literal('git'), Type.Literal('object')]),
  visibility: Type.Optional(
    Type.Union([Type.Literal('public'), Type.Literal('private')]),
  ),
})

export const UpdateSpaceBodySchema = Type.Object(
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

export const AssignableSpaceMemberRoleSchema = Type.Union([
  Type.Literal('writer'),
  Type.Literal('reader'),
])

export const AddSpaceMemberBodySchema = Type.Object({
  email: Type.String({ minLength: 1, maxLength: 320 }),
  role: AssignableSpaceMemberRoleSchema,
})

export const UpdateSpaceMemberBodySchema = Type.Object({
  role: AssignableSpaceMemberRoleSchema,
})

export const SpaceResponseSchema = Type.Object({
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

export const SpaceListResponseSchema = Type.Array(SpaceResponseSchema)

export const SpaceMemberResponseSchema = Type.Object({
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

export const SpaceMemberListResponseSchema = Type.Array(
  SpaceMemberResponseSchema,
)

export const GitCommitResponseSchema = Type.Object({
  id: Type.String({ pattern: '^[0-9a-f]{40,64}$' }),
  shortId: Type.String({ pattern: '^[0-9a-f]+$' }),
  authorName: Type.String(),
  authorEmail: Type.String(),
  authoredAt: Type.String({ format: 'date-time' }),
  message: Type.String(),
})

export const GitRepositoryInfoResponseSchema = Type.Object({
  defaultBranch: Type.String(),
  branches: Type.Array(Type.String()),
  commits: Type.Array(GitCommitResponseSchema),
})

export const GitRefQuerySchema = Type.Object({
  ref: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
})

export const GitTreeQuerySchema = Type.Object({
  ref: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  path: Type.Optional(Type.String({ maxLength: 4096 })),
})

export const GitFileQuerySchema = Type.Object({
  ref: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  path: Type.String({ minLength: 1, maxLength: 4096 }),
})

export const GitDiffQuerySchema = Type.Object({
  from: Type.String({ minLength: 1, maxLength: 255 }),
  to: Type.String({ minLength: 1, maxLength: 255 }),
})

export const GitTagResponseSchema = Type.Object({
  name: Type.String(),
  commitId: Type.String({ pattern: '^[0-9a-f]{40,64}$' }),
})

export const GitTagListResponseSchema = Type.Array(GitTagResponseSchema)

export const GitCommitDetailResponseSchema = Type.Object({
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

export const GitDiffRevisionResponseSchema = Type.Object({
  ref: Type.String(),
  commitId: Type.String({ pattern: '^[0-9a-f]{40,64}$' }),
})

export const GitDiffResponseSchema = Type.Object({
  from: GitDiffRevisionResponseSchema,
  to: GitDiffRevisionResponseSchema,
  patch: Type.String(),
})

export const GitTreeEntryResponseSchema = Type.Object({
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

export const GitTreeResponseSchema = Type.Object({
  ref: Type.String(),
  commitId: Type.String({ pattern: '^[0-9a-f]{40,64}$' }),
  path: Type.String(),
  entries: Type.Array(GitTreeEntryResponseSchema),
})

export const GitFileResponseSchema = Type.Object({
  ref: Type.String(),
  commitId: Type.String({ pattern: '^[0-9a-f]{40,64}$' }),
  path: Type.String(),
  name: Type.String(),
  size: Type.Integer({ minimum: 0 }),
  encoding: Type.Union([Type.Literal('utf-8'), Type.Literal('base64')]),
  content: Type.String(),
})

export const GitReadmeResponseSchema = Type.Union([
  GitFileResponseSchema,
  Type.Null(),
])
