import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Readable } from 'node:stream'

import {
  ObjectServiceError,
  uploadObject,
} from '../services/object/object.js'
import { maximumObjectSizeBytes } from '../services/object/storage.js'
import { requireCurrentUserId } from './current-user.js'
import {
  ObjectKeyParamsSchema,
  SpaceObjectResponseSchema,
} from './types/objects.types.js'

export const objectRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.removeAllContentTypeParsers()
  app.addContentTypeParser('*', (_request, payload, done) => {
    done(null, payload)
  })

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
}
