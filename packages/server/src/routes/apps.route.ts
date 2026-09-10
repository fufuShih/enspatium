import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { getAppSpace, listApps } from '../services/apps.js'
import { getCurrentUserId } from './current-user.route.js'
import { AppResponseSchema, AppSpaceResponseSchema, AppTypeSchema } from './types/apps.types.js'

export const appRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/apps', {
    schema: { operationId: 'listApps', tags: ['apps'], security: [{}, { session: [] }], response: { 200: Type.Array(AppResponseSchema) } },
  }, (request, reply) => {
    reply.header('cache-control', 'private, no-store')
    return listApps(app.db, getCurrentUserId(request))
  })
  app.get('/apps/:appType/spaces/:spaceId', {
    schema: { operationId: 'getAppSpace', tags: ['apps'], security: [{}, { session: [] }],
      params: Type.Object({ appType: AppTypeSchema, spaceId: Type.String({ format: 'uuid' }) }),
      response: { 200: AppSpaceResponseSchema } },
  }, (request, reply) => {
    reply.header('cache-control', 'private, no-store')
    return getAppSpace(app.db, getCurrentUserId(request), request.params.appType, request.params.spaceId)
  })
}
