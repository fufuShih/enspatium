import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'

import {
  addNamespaceMember,
  createOrganizationNamespace,
  getNamespaceBySlug,
  listNamespaceMembers,
  listNamespaces,
  removeNamespaceMember,
} from '../services/namespaces.js'
import { requireCurrentUserId } from './current-user.js'
import {
  AddNamespaceMemberBodySchema,
  CreateOrganizationNamespaceBodySchema,
  NamespaceListResponseSchema,
  NamespaceMemberListResponseSchema,
  NamespaceMemberParamsSchema,
  NamespaceMemberResponseSchema,
  NamespaceParamsSchema,
  NamespaceResponseSchema,
} from './types/namespaces.types.js'

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
          200: NamespaceListResponseSchema,
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
          200: NamespaceMemberListResponseSchema,
        },
      },
    },
    async (request) => {
      const userId = requireCurrentUserId(request)

      return listNamespaceMembers(app.db, userId, request.params.slug)
    },
  )

  app.delete(
    '/namespaces/:slug/members/:userId',
    {
      schema: {
        params: NamespaceMemberParamsSchema,
      },
    },
    async (request, reply) => {
      const userId = requireCurrentUserId(request)

      await removeNamespaceMember(
        app.db,
        userId,
        request.params.slug,
        request.params.userId,
      )

      return reply.code(204).send()
    },
  )
}
