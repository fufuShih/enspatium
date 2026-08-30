import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'

import { listNamespaces } from '../services/namespaces.js'
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

export const namespaceRoutes: FastifyPluginAsyncTypebox = async (app) => {
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
}
