import { Type } from '@sinclair/typebox'
import { AppInstanceResponseSchema, AppTypeSchema } from './apps.types.js'
import { SpaceParamsSchema } from './spaces.types.js'

const instance = AppInstanceResponseSchema.properties
export const SpaceAppResponseSchema = Type.Object({
  id: instance.id, spaceId: instance.spaceId, appType: AppTypeSchema,
  name: instance.name, config: instance.config, pwa: instance.pwa,
  createdAt: instance.createdAt, updatedAt: instance.updatedAt,
})
export const SpaceAppsResponseSchema = Type.Object({
  apps: Type.Array(SpaceAppResponseSchema), canManage: Type.Boolean(),
})
export const SpaceAppParamsSchema = Type.Object({ ...SpaceParamsSchema.properties, appId: Type.String({ format: 'uuid' }) })
export const CreateSpaceAppBodySchema = Type.Object({
  appType: AppTypeSchema,
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
}, { additionalProperties: false })
// Plugin configuration is not exposed as an arbitrary JSON mutation.
export const UpdateSpaceAppBodySchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
}, { additionalProperties: false })

export const UpdateSpaceAppPwaBodySchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
  pwa: Type.Object({
    enabled: Type.Boolean(),
    iconObjectId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    themeColor: Type.Union([Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }), Type.Null()]),
    offlinePolicy: Type.Literal('shell'),
  }, { additionalProperties: false }),
  publishAcknowledged: Type.Optional(Type.Boolean()),
  refreshIcon: Type.Optional(Type.Boolean()),
}, { additionalProperties: false })

export const PublicPwaEntrySchema = Type.Object({
  id: instance.id, appType: AppTypeSchema, enabled: Type.Boolean(),
  name: Type.Optional(Type.String()), themeColor: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  version: Type.Optional(Type.String()),
})
