import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'

import {
  addNamespaceMember,
  createOrganizationNamespace,
  getNamespaceBySlug,
  listNamespaceMembers,
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

const AddNamespaceMemberBodySchema = Type.Object({
  email: Type.String({ minLength: 1, maxLength: 320 }),
})

const NamespaceMemberResponseSchema = Type.Object({
  userId: Type.String({ format: 'uuid' }),
  email: Type.String(),
  displayName: Type.String(),
  role: Type.Union([Type.Literal('owner'), Type.Literal('member')]),
  joinedAt: Type.String(),
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

  app.post(
    '/namespaces/:slug/members',
    {
      schema: {
        params: NamespaceParamsSchema,
        body: AddNamespaceMemberBodySchema,
        response: {
          201: NamespaceMemberResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const userId = requireCurrentUserId(request)
      const member = await addNamespaceMember(
        app.db,
        userId,
        request.params.slug,
        request.body,
      )

      return reply.code(201).send(member)
    },
  )

  app.get(
    '/namespaces/:slug/members',
    {
      schema: {
        params: NamespaceParamsSchema,
        response: {
          200: Type.Array(NamespaceMemberResponseSchema),
        },
      },
    },
    async (request) => {
      const userId = requireCurrentUserId(request)

      return listNamespaceMembers(app.db, userId, request.params.slug)
    },
  )
}
