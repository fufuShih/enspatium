import { Type } from '@sinclair/typebox'

import { maximumObjectListLimit } from '../../services/object/object.js'

export const ObjectSpaceParamsSchema = Type.Object({
  namespaceSlug: Type.String({ minLength: 1, maxLength: 100 }),
  spaceSlug: Type.String({ minLength: 1, maxLength: 100 }),
})

export const ObjectKeyParamsSchema = Type.Object({
  namespaceSlug: Type.String({ minLength: 1, maxLength: 100 }),
  spaceSlug: Type.String({ minLength: 1, maxLength: 100 }),
  '*': Type.String({ minLength: 1, maxLength: 1024 }),
})

export const ObjectListQuerySchema = Type.Object({
  prefix: Type.Optional(Type.String({ maxLength: 1024 })),
  limit: Type.Optional(
    Type.Integer({ minimum: 1, maximum: maximumObjectListLimit }),
  ),
})

export const SpaceObjectResponseSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  spaceId: Type.String({ format: 'uuid' }),
  createdByUserId: Type.Union([
    Type.String({ format: 'uuid' }),
    Type.Null(),
  ]),
  key: Type.String(),
  contentType: Type.String(),
  sizeBytes: Type.Integer({ minimum: 0 }),
  checksumSha256: Type.String({ pattern: '^[0-9a-f]{64}$' }),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
  versionId: Type.String({ format: 'uuid' }),
  revision: Type.Integer({ minimum: 1 }),
  isDeleted: Type.Boolean(),
})

export const SpaceObjectListResponseSchema = Type.Array(
  SpaceObjectResponseSchema,
)

export const MediaKindSchema = Type.Union([Type.Literal('audio'), Type.Literal('video'), Type.Literal('image')])
export const MediaQuerySchema = Type.Object({
  kind: Type.Optional(MediaKindSchema),
  search: Type.Optional(Type.String({ maxLength: 128 })),
  cursor: Type.Optional(Type.String({ maxLength: 1024 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
})
export const MediaResponseSchema = Type.Object({
  canUpload: Type.Boolean(),
  objects: Type.Array(Type.Object({ ...SpaceObjectResponseSchema.properties, kind: MediaKindSchema })),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
})

export const ObjectFolderQuerySchema = Type.Object({
  prefix: Type.Optional(Type.String({ maxLength: 1024 })),
  filter: Type.Optional(Type.String({ maxLength: 1024 })),
  cursor: Type.Optional(Type.String({ maxLength: 1024 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: maximumObjectListLimit })),
  deleted: Type.Optional(Type.Boolean()),
})

export const ObjectFolderResponseSchema = Type.Object({
  prefix: Type.String(),
  folders: Type.Array(Type.String()),
  objects: SpaceObjectListResponseSchema,
  nextCursor: Type.Union([Type.String(), Type.Null()]),
})

export const ObjectStorageUsageResponseSchema = Type.Object({
  usedBytes: Type.Integer({ minimum: 0 }),
  quotaBytes: Type.Integer({ minimum: 1 }),
  remainingBytes: Type.Integer({ minimum: 0 }),
})

export const ObjectHeadQuerySchema = Type.Object({ key: Type.String({ minLength: 1, maxLength: 1024 }) })
export const ObjectWriteQuerySchema = Type.Object({
  expectedVersion: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Literal('none')])),
})
export const ObjectVersionsQuerySchema = Type.Object({
  ...ObjectHeadQuerySchema.properties,
  cursor: Type.Optional(Type.Integer({ minimum: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
})
export const ObjectVersionQuerySchema = Type.Object({
  ...ObjectHeadQuerySchema.properties,
  versionId: Type.String({ format: 'uuid' }),
})
export const RestoreObjectVersionQuerySchema = Type.Object({
  ...ObjectVersionQuerySchema.properties,
  expectedVersion: Type.String({ format: 'uuid' }),
})
export const ObjectVersionsResponseSchema = Type.Object({
  versionLimit: Type.Integer({ minimum: 1 }),
  retentionDays: Type.Integer({ minimum: 1 }),
  object: SpaceObjectResponseSchema,
  versions: Type.Array(Type.Object({
    ...SpaceObjectResponseSchema.properties,
    createdByName: Type.Union([Type.String(), Type.Null()]),
  })),
  nextCursor: Type.Union([Type.Integer(), Type.Null()]),
})
