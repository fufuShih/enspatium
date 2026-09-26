import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { getAppObject, listAppObjects, openAppContent } from '../services/app-objects.js'
import { getCurrentUserId } from './current-user.route.js'
import { sendObjectContent } from './object-content.js'
import { AppInstanceObjectParamsSchema, AppObjectParamsSchema, AppObjectSchema, AppObjectsQuerySchema, AppObjectsResponseSchema, AppObjectSpaceParamsSchema } from './types/app-objects.types.js'
import { AppInstanceParamsSchema } from './types/apps.types.js'
import { ObjectVersionQuerySchema } from './types/objects.types.js'

export const appObjectRoutes: FastifyPluginAsyncTypebox = async app => {
  const base = '/namespaces/:namespaceSlug/spaces/:spaceSlug/:appType'
  app.get(base, {
    schema: { operationId: 'listAppObjects', tags: ['app-objects'], security: [{}, { session: [] }],
      params: AppObjectSpaceParamsSchema, querystring: AppObjectsQuerySchema, response: { 200: AppObjectsResponseSchema } },
  }, (request, reply) => {
    reply.header('cache-control', 'private, no-store')
    const { namespaceSlug, spaceSlug, appType } = request.params
    return listAppObjects(app.db, app.config.DATA_ROOT, getCurrentUserId(request), { account: namespaceSlug, slug: spaceSlug, appType }, request.query)
  })
  app.get(base + '/:itemId', {
    schema: { operationId: 'getAppObject', tags: ['app-objects'], security: [{}, { session: [] }],
      params: AppObjectParamsSchema, response: { 200: AppObjectSchema } },
  }, (request, reply) => {
    reply.header('cache-control', 'private, no-store')
    const { namespaceSlug, spaceSlug, appType, itemId } = request.params
    return getAppObject(app.db, app.config.DATA_ROOT, getCurrentUserId(request), { account: namespaceSlug, slug: spaceSlug, appType }, itemId)
  })
  for (const method of ['GET', 'HEAD'] as const) {
    app.route({ method, url: base + '/content', exposeHeadRoute: false,
      config: { swagger: { exposeHeadRoute: true } },
      schema: { operationId: 'downloadAppContent', tags: ['app-objects'], security: [{}, { session: [] }],
        params: AppObjectSpaceParamsSchema, querystring: ObjectVersionQuerySchema },
      handler: async (request, reply) => {
        const { namespaceSlug, spaceSlug, appType } = request.params
        const content = await openAppContent(app.db, app.config.DATA_ROOT, getCurrentUserId(request),
          { account: namespaceSlug, slug: spaceSlug, appType }, request.query.key, request.query.versionId)
        return sendObjectContent(request, reply, content)
      },
    })
  }

  const instanceBase = '/apps/:appType/instances/:appId/objects'
  app.get(instanceBase, {
    schema: { operationId: 'listAppInstanceObjects', tags: ['app-objects'], security: [{}, { session: [] }],
      params: AppInstanceParamsSchema, querystring: AppObjectsQuerySchema, response: { 200: AppObjectsResponseSchema } },
  }, (request, reply) => {
    reply.header('cache-control', 'private, no-store')
    return listAppObjects(app.db, app.config.DATA_ROOT, getCurrentUserId(request), request.params, request.query)
  })
  app.get(instanceBase + '/:itemId', {
    schema: { operationId: 'getAppInstanceObject', tags: ['app-objects'], security: [{}, { session: [] }],
      params: AppInstanceObjectParamsSchema, response: { 200: AppObjectSchema } },
  }, (request, reply) => {
    reply.header('cache-control', 'private, no-store')
    return getAppObject(app.db, app.config.DATA_ROOT, getCurrentUserId(request), request.params, request.params.itemId)
  })
  for (const method of ['GET', 'HEAD'] as const) {
    app.route({ method, url: instanceBase + '/content', exposeHeadRoute: false,
      config: { swagger: { exposeHeadRoute: true } },
      schema: { operationId: 'downloadAppInstanceContent', tags: ['app-objects'], security: [{}, { session: [] }],
        params: AppInstanceParamsSchema, querystring: ObjectVersionQuerySchema },
      handler: async (request, reply) => {
        const content = await openAppContent(app.db, app.config.DATA_ROOT, getCurrentUserId(request),
          request.params, request.query.key, request.query.versionId)
        return sendObjectContent(request, reply, content)
      },
    })
  }
}
