import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'

import {
  UserServiceError,
  authenticateUser,
  getUser,
} from '../services/users.js'
import {
  authenticationRequired,
  requireCurrentUserId,
} from './current-user.js'
import { UserResponseSchema } from './users.js'

const LoginBodySchema = Type.Object({
  email: Type.String({ minLength: 1, maxLength: 320 }),
  password: Type.String({ minLength: 1, maxLength: 1024 }),
})

export const authRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    '/auth/login',
    {
      schema: {
        body: LoginBodySchema,
        response: {
          200: UserResponseSchema,
        },
      },
    },
    async (request) => {
      const user = await authenticateUser(
        app.db,
        request.body.email,
        request.body.password,
      )

      request.session.regenerate()
      request.session.set('userId', user.id)

      return user
    },
  )

  app.get(
    '/auth/me',
    {
      schema: {
        response: {
          200: UserResponseSchema,
        },
      },
    },
    async (request) => {
      const userId = requireCurrentUserId(request)

      try {
        return await getUser(app.db, userId)
      } catch (error) {
        if (error instanceof UserServiceError && error.code === 'NOT_FOUND') {
          request.session.delete()
          throw authenticationRequired()
        }

        throw error
      }
    },
  )

  app.post('/auth/logout', async (request, reply) => {
    request.session.delete()

    return reply.code(204).send()
  })
}
