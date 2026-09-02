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
      schema: {
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
        params: UserParamsSchema,
        response: {
          200: UserResponseSchema,
        },
      },
    },
    async (request) => getUser(app.db, request.params.id),
  )
}
