import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'

import {
  createPersonalAccessToken,
  listPersonalAccessTokens,
  revokePersonalAccessToken,
} from '../services/tokens.js'
import { requireCurrentUserId } from './current-user.js'

const PersonalAccessTokenScopeSchema = Type.Union([
  Type.Literal('git:read'),
  Type.Literal('git:write'),
])

const PersonalAccessTokenResponseProperties = {
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  scopes: Type.Array(PersonalAccessTokenScopeSchema),
  expiresAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  lastUsedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  revokedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
}

const PersonalAccessTokenResponseSchema = Type.Object(
  PersonalAccessTokenResponseProperties,
)

const CreatedPersonalAccessTokenResponseSchema = Type.Object({
  ...PersonalAccessTokenResponseProperties,
  token: Type.String(),
})

const CreatePersonalAccessTokenBodySchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
  scopes: Type.Array(PersonalAccessTokenScopeSchema, {
    minItems: 1,
    maxItems: 2,
    uniqueItems: true,
  }),
  expiresAt: Type.Optional(Type.String({ format: 'date-time' })),
})

const PersonalAccessTokenParamsSchema = Type.Object({
  tokenId: Type.String({ format: 'uuid' }),
})

export const tokenRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    '/auth/tokens',
    {
      schema: {
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
        response: {
          200: Type.Array(PersonalAccessTokenResponseSchema),
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
        params: PersonalAccessTokenParamsSchema,
      },
    },
    async (request, reply) => {
      await revokePersonalAccessToken(
        app.db,
        requireCurrentUserId(request),
        request.params.tokenId,
      )

      return reply.code(204).send()
    },
  )
}
