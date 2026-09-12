import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'

import { createUser, getUser } from '../services/users.js'
import {
  CreateUserBodySchema,
  UserParamsSchema,
  UserResponseSchema,
} from './types/users.types.js'

export const userRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    '/users',
    {
      config: { rateLimit: { max: () => app.config.REGISTRATION_RATE_LIMIT, timeWindow: '1 minute' } },
      onRequest: async () => {
        if (app.config?.REGISTRATION_ENABLED === false) throw Object.assign(new Error('Registration is closed. Contact the site administrator.'), { statusCode: 403, code: 'REGISTRATION_CLOSED' })
      },
      schema: {
        operationId: 'createUser',
        tags: ['users'],
        security: [],
        body: CreateUserBodySchema,
        response: {
          201: UserResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const user = await createUser(app.db, request.body)

      return reply.code(201).send(user)
    },
  )

  app.get(
    '/users/:id',
    {
      schema: {
        operationId: 'getUser',
        tags: ['users'],
        security: [],
        params: UserParamsSchema,
        response: {
          200: UserResponseSchema,
        },
      },
    },
    async (request) => getUser(app.db, request.params.id),
  )
}
