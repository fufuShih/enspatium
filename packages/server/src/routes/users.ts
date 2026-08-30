import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'

import { createUser, getUser } from '../services/users.js'

export const UserResponseSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  email: Type.String(),
  displayName: Type.String(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
})

const CreateUserBodySchema = Type.Object({
  email: Type.String({ minLength: 1, maxLength: 320 }),
  password: Type.String({ minLength: 8, maxLength: 1024 }),
  displayName: Type.String({ minLength: 1, maxLength: 100 }),
})

const UserParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
})

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
