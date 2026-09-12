import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { getAppObject, listAppObjects, openAppContent } from '../services/app-objects.js'
import { getCurrentUserId } from './current-user.route.js'
import { sendObjectContent } from './object-content.js'
import { AppObjectParamsSchema, AppObjectSchema, AppObjectsQuerySchema, AppObjectsResponseSchema, AppObjectSpaceParamsSchema } from './types/app-objects.types.js'
import { ObjectVersionQuerySchema } from './types/objects.types.js'

export const appObjectRoutes: FastifyPluginAsyncTypebox = async app => {
  const base = '/namespaces/:namespaceSlug/spaces/:spaceSlug/:appType'
  app.get(base, {
    schema: { operationId: 'listAppObjects', tags: ['app-objects'], security: [{}, { session: [] }],
      params: AppObjectSpaceParamsSchema, querystring: AppObjectsQuerySchema, response: { 200: AppObjectsResponseSchema } },
  }, (request, reply) => {
    reply.header('cache-control', 'private, no-store')
    const { namespaceSlug, spaceSlug, appType } = request.params
    return listAppObjects(app.db, app.config.DATA_ROOT, getCurrentUserId(request), namespaceSlug, spaceSlug, appType, request.query)
  })
  app.get(base + '/:itemId', {
    schema: { operationId: 'getAppObject', tags: ['app-objects'], security: [{}, { session: [] }],
      params: AppObjectParamsSchema, response: { 200: AppObjectSchema } },
  }, (request, reply) => {
    reply.header('cache-control', 'private, no-store')
    const { namespaceSlug, spaceSlug, appType, itemId } = request.params
    return getAppObject(app.db, app.config.DATA_ROOT, getCurrentUserId(request), namespaceSlug, spaceSlug, appType, itemId)
  })
  for (const method of ['GET', 'HEAD'] as const) {
    app.route({ method, url: base + '/content', exposeHeadRoute: false,
      config: { swagger: { exposeHeadRoute: true } },
      schema: { operationId: 'downloadAppContent', tags: ['app-objects'], security: [{}, { session: [] }],
        params: AppObjectSpaceParamsSchema, querystring: ObjectVersionQuerySchema },
      handler: async (request, reply) => {
        const { namespaceSlug, spaceSlug, appType } = request.params
        const content = await openAppContent(app.db, app.config.DATA_ROOT, getCurrentUserId(request),
          namespaceSlug, spaceSlug, appType, request.query.key, request.query.versionId)
        return sendObjectContent(request, reply, content)
      },
    })
  }
}
