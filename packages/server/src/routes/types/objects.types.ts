import { Type } from '@sinclair/typebox'

export const ObjectKeyParamsSchema = Type.Object({
  namespaceSlug: Type.String({ minLength: 1, maxLength: 100 }),
  spaceSlug: Type.String({ minLength: 1, maxLength: 100 }),
  '*': Type.String({ minLength: 1, maxLength: 1024 }),
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
