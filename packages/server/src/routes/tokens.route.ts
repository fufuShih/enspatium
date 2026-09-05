import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'

import {
  createPersonalAccessToken,
  listPersonalAccessTokens,
  revokePersonalAccessToken,
} from '../services/tokens.js'
import { requireCurrentUserId } from './current-user.route.js'
import {
  CreatedPersonalAccessTokenResponseSchema,
  CreatePersonalAccessTokenBodySchema,
  PersonalAccessTokenListResponseSchema,
  PersonalAccessTokenParamsSchema,
} from './types/tokens.types.js'

export const tokenRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    '/auth/tokens',
    {
      schema: {
        operationId: 'createPersonalAccessToken',
        tags: ['tokens'],
        body: CreatePersonalAccessTokenBodySchema,
        response: {
          201: CreatedPersonalAccessTokenResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const token = await createPersonalAccessToken(
        app.db,
        requireCurrentUserId(request),
        request.body,
      )

      return reply.code(201).send(token)
    },
  )

  app.get(
    '/auth/tokens',
    {
      schema: {
        operationId: 'listPersonalAccessTokens',
        tags: ['tokens'],
        response: {
          200: PersonalAccessTokenListResponseSchema,
        },
      },
    },
    async (request) =>
      listPersonalAccessTokens(app.db, requireCurrentUserId(request)),
  )

  app.delete(
    '/auth/tokens/:tokenId',
    {
      schema: {
        operationId: 'revokePersonalAccessToken',
        tags: ['tokens'],
        response: { 204: Type.Null() },
        params: PersonalAccessTokenParamsSchema,
      },
    },
    async (request, reply) => {
      await revokePersonalAccessToken(
        app.db,
        requireCurrentUserId(request),
        request.params.tokenId,
      )

      return reply.code(204).send(null)
    },
  )
}
