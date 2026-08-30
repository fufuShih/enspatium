import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'

import { createSpace, listSpaces } from '../services/space.js'
import { requireCurrentUserId } from './current-user.js'

const NamespaceParamsSchema = Type.Object({
  namespaceSlug: Type.String({ minLength: 1, maxLength: 100 }),
})

const CreateSpaceBodySchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
  slug: Type.String({ minLength: 1, maxLength: 100 }),
  type: Type.Union([Type.Literal('git'), Type.Literal('object')]),
  visibility: Type.Optional(
    Type.Union([Type.Literal('public'), Type.Literal('private')]),
  ),
})

const SpaceResponseSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  namespaceId: Type.String({ format: 'uuid' }),
  createdByUserId: Type.Union([
    Type.String({ format: 'uuid' }),
    Type.Null(),
  ]),
  name: Type.String(),
  slug: Type.String(),
  type: Type.Union([Type.Literal('git'), Type.Literal('object')]),
  visibility: Type.Union([
    Type.Literal('public'),
    Type.Literal('private'),
  ]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
})

export const spaceRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    '/namespaces/:namespaceSlug/spaces',
    {
      schema: {
        params: NamespaceParamsSchema,
        body: CreateSpaceBodySchema,
        response: {
          201: SpaceResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const userId = requireCurrentUserId(request)
      const space = await createSpace(
        app.db,
        userId,
        request.params.namespaceSlug,
        request.body,
      )

      return reply.code(201).send(space)
    },
  )

  app.get(
    '/namespaces/:namespaceSlug/spaces',
    {
      schema: {
        params: NamespaceParamsSchema,
        response: {
          200: Type.Array(SpaceResponseSchema),
        },
      },
    },
    async (request) => {
      const userId = requireCurrentUserId(request)

      return listSpaces(app.db, userId, request.params.namespaceSlug)
    },
  )
}
