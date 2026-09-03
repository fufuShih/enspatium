import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Readable } from 'node:stream'

import {
  deleteObject,
  downloadObject,
  getObjectStorageUsage,
  listObjects,
  ObjectServiceError,
  uploadObject,
} from '../services/object/object.js'
import { maximumObjectSizeBytes } from '../services/object/storage.js'
import {
  getCurrentUserId,
  requireCurrentUserId,
} from './current-user.route.js'
import {
  ObjectKeyParamsSchema,
  ObjectListQuerySchema,
  ObjectSpaceParamsSchema,
  ObjectStorageUsageResponseSchema,
  SpaceObjectListResponseSchema,
  SpaceObjectResponseSchema,
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
        requireCurrentUserId(request),
        request.params.namespaceSlug,
        request.params.spaceSlug,
        request.query.prefix,
        request.query.limit,
      )
    },
  )

  app.put(
    '/namespaces/:namespaceSlug/spaces/:spaceSlug/objects/*',
    {
      bodyLimit: maximumObjectSizeBytes,
      schema: {
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

  app.get(
    '/namespaces/:namespaceSlug/spaces/:spaceSlug/objects/*',
    {
      schema: {
        params: ObjectKeyParamsSchema,
      },
    },
    async (request, reply) => {
      const download = await downloadObject(
        app.db,
        app.config.DATA_ROOT,
        getCurrentUserId(request),
        request.params.namespaceSlug,
        request.params.spaceSlug,
        request.params['*'],
      )

      return reply
        .header('content-type', download.object.contentType)
        .header('content-length', download.object.sizeBytes)
        .header('etag', `"${download.object.checksumSha256}"`)
        .header('x-content-sha256', download.object.checksumSha256)
        .send(download.stream)
    },
  )

  app.delete(
    '/namespaces/:namespaceSlug/spaces/:spaceSlug/objects/*',
    {
      schema: {
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
      )

      return reply.code(204).send()
    },
  )
}
