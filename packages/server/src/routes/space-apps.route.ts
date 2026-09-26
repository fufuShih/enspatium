import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { createAppInstance, deleteAppInstance, listSpaceApps, toAppInstanceSummary, updateAppInstance } from '../services/app-instances.js'
import { getCurrentUserId, requireCurrentUserId } from './current-user.route.js'
import { SpaceParamsSchema } from './types/spaces.types.js'
import { CreateSpaceAppBodySchema, SpaceAppParamsSchema, SpaceAppResponseSchema, SpaceAppsResponseSchema, UpdateSpaceAppBodySchema } from './types/space-apps.types.js'

export const spaceAppRoutes: FastifyPluginAsyncTypebox = async app => {
  const base = '/namespaces/:namespaceSlug/spaces/:spaceSlug/apps'
  app.get(base, {
    schema: { operationId: 'listSpaceApps', tags: ['space-apps'], security: [{}, { session: [] }],
      params: SpaceParamsSchema, response: { 200: SpaceAppsResponseSchema } },
  }, (request, reply) => {
    reply.header('cache-control', 'private, no-store')
    return listSpaceApps(app.db, getCurrentUserId(request), request.params.namespaceSlug, request.params.spaceSlug)
  })
  app.post(base, {
    schema: { operationId: 'createSpaceApp', tags: ['space-apps'], params: SpaceParamsSchema,
      body: CreateSpaceAppBodySchema, response: { 201: SpaceAppResponseSchema } },
  }, async (request, reply) => {
    reply.header('cache-control', 'private, no-store')
    const instance = await createAppInstance(app.db, requireCurrentUserId(request), request.params.namespaceSlug, request.params.spaceSlug, request.body)
    return reply.code(201).send(toAppInstanceSummary(instance))
  })
  app.patch(base + '/:appId', {
    schema: { operationId: 'updateSpaceApp', tags: ['space-apps'], params: SpaceAppParamsSchema,
      body: UpdateSpaceAppBodySchema, response: { 200: SpaceAppResponseSchema } },
  }, async (request, reply) => {
    reply.header('cache-control', 'private, no-store')
    const instance = await updateAppInstance(app.db, requireCurrentUserId(request), request.params.namespaceSlug, request.params.spaceSlug, request.params.appId, request.body)
    return toAppInstanceSummary(instance)
  })
  app.delete(base + '/:appId', {
    schema: { operationId: 'deleteSpaceApp', tags: ['space-apps'], params: SpaceAppParamsSchema, response: { 204: Type.Null() } },
  }, async (request, reply) => {
    reply.header('cache-control', 'private, no-store')
    await deleteAppInstance(app.db, requireCurrentUserId(request), request.params.namespaceSlug, request.params.spaceSlug, request.params.appId)
    return reply.code(204).send(null)
  })
}
