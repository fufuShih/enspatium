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
})

export const SpaceObjectListResponseSchema = Type.Array(
  SpaceObjectResponseSchema,
)
