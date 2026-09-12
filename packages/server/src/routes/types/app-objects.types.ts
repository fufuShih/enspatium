import { Type } from '@sinclair/typebox'
import { AppTypeSchema } from './apps.types.js'
import { ObjectSpaceParamsSchema, SpaceObjectResponseSchema } from './objects.types.js'

export const AppObjectSpaceParamsSchema = Type.Object({ ...ObjectSpaceParamsSchema.properties, appType: AppTypeSchema })
export const AppObjectParamsSchema = Type.Object({ ...AppObjectSpaceParamsSchema.properties, itemId: Type.String({ format: 'uuid' }) })
export const AppObjectSchema = Type.Object({ ...SpaceObjectResponseSchema.properties, kind: Type.String() })
export const AppObjectsQuerySchema = Type.Object({
  kind: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })),
  search: Type.Optional(Type.String({ maxLength: 128 })),
  cursor: Type.Optional(Type.String({ maxLength: 1024 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
})
export const AppObjectsResponseSchema = Type.Object({
  canUpload: Type.Boolean(),
  objects: Type.Array(AppObjectSchema),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
})
