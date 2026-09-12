import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Readable } from 'node:stream'

import {
  browseObjects,
  openObjectDownload,
  getObjectStorageUsage,
  listObjects,
  ObjectServiceError,
} from '../services/object/object.js'
import { maximumObjectSizeBytes } from '../services/object/storage.js'
import { sendObjectContent } from './object-content.js'
import { deleteObject, getObjectHead, listObjectVersions, restoreObjectVersion, uploadObject } from '../services/object/versions.js'
import { moveObject } from '../services/object/move.js'
import {
  getCurrentUserId,
  requireCurrentUserId,
} from './current-user.route.js'
import {
  ObjectKeyParamsSchema,
  ObjectFolderQuerySchema,
  ObjectFolderResponseSchema,
  ObjectListQuerySchema,
  ObjectSpaceParamsSchema,
  ObjectStorageUsageResponseSchema,
  SpaceObjectListResponseSchema,
  SpaceObjectResponseSchema,
  ObjectHeadQuerySchema, ObjectWriteQuerySchema, ObjectVersionsQuerySchema,
  ObjectVersionQuerySchema, RestoreObjectVersionQuerySchema, ObjectVersionsResponseSchema,
  MoveObjectQuerySchema,
} from './types/objects.types.js'

export const objectRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.removeAllContentTypeParsers()
  app.addContentTypeParser('*', (_request, payload, done) => {
    done(null, payload)
  })

  app.get(
    '/namespaces/:namespaceSlug/spaces/:spaceSlug/storage',
    {
      schema: {
        operationId: 'getObjectStorageUsage',
        tags: ['objects'],
        params: ObjectSpaceParamsSchema,
        response: {
          200: ObjectStorageUsageResponseSchema,
        },
      },
    },
    async (request) => {
      return getObjectStorageUsage(
        app.db,
        requireCurrentUserId(request),
        request.params.namespaceSlug,
        request.params.spaceSlug,
      )
    },
  )

  app.get(
    '/namespaces/:namespaceSlug/spaces/:spaceSlug/objects',
    {
      schema: {
        operationId: 'listObjects',
        tags: ['objects'],
        params: ObjectSpaceParamsSchema,
        querystring: ObjectListQuerySchema,
        response: {
          200: SpaceObjectListResponseSchema,
        },
      },
    },
    async (request) => {
      return listObjects(
        app.db,
        app.config.DATA_ROOT,
        requireCurrentUserId(request),
        request.params.namespaceSlug,
        request.params.spaceSlug,
        request.query.prefix,
        request.query.limit,
      )
    },
  )

  // Keep this outside /objects/* so existing object keys remain downloadable.
  app.get(
    '/namespaces/:namespaceSlug/spaces/:spaceSlug/object-tree',
    {
      schema: {
        operationId: 'browseObjects', tags: ['objects'],
        params: ObjectSpaceParamsSchema, querystring: ObjectFolderQuerySchema,
        response: { 200: ObjectFolderResponseSchema },
      },
    },
    async request => browseObjects(
      app.db, app.config.DATA_ROOT, requireCurrentUserId(request),
      request.params.namespaceSlug, request.params.spaceSlug, request.query,
    ),
  )

  app.put(
    '/namespaces/:namespaceSlug/spaces/:spaceSlug/objects/*',
    {
      bodyLimit: maximumObjectSizeBytes,
      schema: {
        operationId: 'uploadObject',
        querystring: ObjectWriteQuerySchema,
        tags: ['objects'],
        params: ObjectKeyParamsSchema,
        response: {
          201: SpaceObjectResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (!(request.body instanceof Readable)) {
        throw new ObjectServiceError(
          'INVALID_INPUT',
          400,
          'object request body is required',
        )
      }

      const object = await uploadObject(
        app.db,
        app.config.DATA_ROOT,
        requireCurrentUserId(request),
        request.params.namespaceSlug,
        request.params.spaceSlug,
        {
          key: request.params['*'],
          source: request.body,
          ...(request.query.expectedVersion ? { expectedVersion: request.query.expectedVersion } : {}),
          ...(request.headers['content-type']
            ? { contentType: request.headers['content-type'] }
            : {}),
          ...(request.headers['content-length']
            ? { contentLength: request.headers['content-length'] }
            : {}),
        },
      )

      return reply.code(201).send(object)
    },
  )

  // Explicit HEAD handlers preserve Content-Length without draining a file stream.
  for (const method of ['GET', 'HEAD'] as const) {
    app.route({
      method,
      url: '/namespaces/:namespaceSlug/spaces/:spaceSlug/objects/*',
      exposeHeadRoute: false,
      config: { swagger: { exposeHeadRoute: true } },
      schema: {
        operationId: 'downloadObject',
        tags: ['objects'],
        security: [{}, { session: [] }],
        params: ObjectKeyParamsSchema,
      },
      handler: async (request, reply) => {
        const download = await openObjectDownload(
          app.db, app.config.DATA_ROOT, getCurrentUserId(request),
          request.params.namespaceSlug, request.params.spaceSlug, request.params['*'],
        )
        return sendObjectContent(request, reply, download)
      },
    })
  }

  app.delete(
    '/namespaces/:namespaceSlug/spaces/:spaceSlug/objects/*',
    {
      schema: {
        operationId: 'deleteObject',
        querystring: ObjectWriteQuerySchema,
        tags: ['objects'],
        response: { 204: Type.Null() },
        params: ObjectKeyParamsSchema,
      },
    },
    async (request, reply) => {
      await deleteObject(
        app.db,
        app.config.DATA_ROOT,
        requireCurrentUserId(request),
        request.params.namespaceSlug,
        request.params.spaceSlug,
        request.params['*'],
        request.query.expectedVersion,
      )

      return reply.code(204).send(null)
    },
  )

  app.get('/namespaces/:namespaceSlug/spaces/:spaceSlug/object-head', {
    schema: { operationId: 'getObjectHead', tags: ['objects'], params: ObjectSpaceParamsSchema,
      querystring: ObjectHeadQuerySchema, response: { 200: Type.Union([SpaceObjectResponseSchema, Type.Null()]) } },
  }, request => getObjectHead(app.db, requireCurrentUserId(request), request.params.namespaceSlug, request.params.spaceSlug, request.query.key))

  app.post('/namespaces/:namespaceSlug/spaces/:spaceSlug/object-move', {
    schema: { operationId: 'moveObject', tags: ['objects'], params: ObjectSpaceParamsSchema,
      description: 'Rename or move one active file within this Space. Preserves object ID, content versions and storage locators. Requires the source key and current version; rejects destination collisions, including deleted files. Repeating the same successful request is a no-op.',
      querystring: MoveObjectQuerySchema, response: { 200: SpaceObjectResponseSchema } },
  }, request => moveObject(app.db, app.config.DATA_ROOT, requireCurrentUserId(request), request.params.namespaceSlug, request.params.spaceSlug, request.query))

  app.get('/namespaces/:namespaceSlug/spaces/:spaceSlug/object-versions', {
    schema: { operationId: 'listObjectVersions', tags: ['objects'], params: ObjectSpaceParamsSchema,
      querystring: ObjectVersionsQuerySchema, response: { 200: ObjectVersionsResponseSchema } },
  }, request => listObjectVersions(app.db, requireCurrentUserId(request), request.params.namespaceSlug, request.params.spaceSlug, request.query))

  app.post('/namespaces/:namespaceSlug/spaces/:spaceSlug/object-versions/restore', {
    schema: { operationId: 'restoreObjectVersion', tags: ['objects'], params: ObjectSpaceParamsSchema,
      querystring: RestoreObjectVersionQuerySchema, response: { 201: SpaceObjectResponseSchema } },
  }, async (request, reply) => reply.code(201).send(await restoreObjectVersion(app.db, app.config.DATA_ROOT,
    requireCurrentUserId(request), request.params.namespaceSlug, request.params.spaceSlug, request.query)))

  for (const method of ['GET', 'HEAD'] as const) {
    app.route({
      method,
      url: '/namespaces/:namespaceSlug/spaces/:spaceSlug/object-versions/content',
      exposeHeadRoute: false,
      config: { swagger: { exposeHeadRoute: true } },
      schema: { operationId: 'downloadObjectVersion', tags: ['objects'], params: ObjectSpaceParamsSchema,
        querystring: ObjectVersionQuerySchema },
      handler: async (request, reply) => {
        const download = await openObjectDownload(app.db, app.config.DATA_ROOT, requireCurrentUserId(request),
          request.params.namespaceSlug, request.params.spaceSlug, request.query.key, request.query.versionId)
        return sendObjectContent(request, reply, download)
      },
    })
  }
}
