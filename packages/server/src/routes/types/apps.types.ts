import { Type } from '@sinclair/typebox'

export const AppTypeSchema = Type.String({ minLength: 3, maxLength: 60, pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' })
export const AppResponseSchema = Type.Object({
  type: AppTypeSchema,
  name: Type.String(),
  kind: Type.Union([Type.Literal('builtin'), Type.Literal('custom')]),
  ownerUserId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  storageType: Type.Union([Type.Literal('git'), Type.Literal('object')]),
})
export const AppSpaceResponseSchema = Type.Object({
  id: Type.String({ format: 'uuid' }), name: Type.String(), slug: Type.String(), account: Type.String(),
  app: AppResponseSchema,
})
