import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'

import {
  createOrganizationNamespace,
  getNamespaceBySlug,
  listNamespaces,
} from '../services/namespaces.js'
import { requireCurrentUserId } from './current-user.js'

const NamespaceResponseSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  ownerUserId: Type.String({ format: 'uuid' }),
  name: Type.String(),
  slug: Type.String(),
  kind: Type.Union([
    Type.Literal('personal'),
    Type.Literal('organization'),
  ]),
  createdAt: Type.String(),
})

const CreateOrganizationNamespaceBodySchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
  slug: Type.String({ minLength: 1, maxLength: 100 }),
})

const NamespaceParamsSchema = Type.Object({
  slug: Type.String({ minLength: 1, maxLength: 100 }),
})

export const namespaceRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    '/namespaces',
    {
      schema: {
        body: CreateOrganizationNamespaceBodySchema,
        response: {
          201: NamespaceResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const userId = requireCurrentUserId(request)
      const namespace = await createOrganizationNamespace(
        app.db,
        userId,
        request.body,
      )

      return reply.code(201).send(namespace)
    },
  )

  app.get(
    '/namespaces',
    {
      schema: {
        response: {
          200: Type.Array(NamespaceResponseSchema),
        },
      },
    },
    async (request) => {
      const userId = requireCurrentUserId(request)

      return listNamespaces(app.db, userId)
    },
  )

  app.get(
    '/namespaces/:slug',
    {
      schema: {
        params: NamespaceParamsSchema,
        response: {
          200: NamespaceResponseSchema,
        },
      },
    },
    async (request) => {
      return getNamespaceBySlug(app.db, request.params.slug)
    },
  )
}
