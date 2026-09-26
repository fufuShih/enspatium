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
// Configuration and PWA settings are intentionally not public mutations yet.
export const UpdateSpaceAppBodySchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
}, { additionalProperties: false })
