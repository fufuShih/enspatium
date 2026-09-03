import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'

import {
  UserServiceError,
  authenticateUser,
  getUser,
} from '../services/users.js'
import {
  authenticationRequired,
  requireCurrentUserId,
} from './current-user.route.js'
import { LoginBodySchema } from './types/auth.types.js'
import { UserResponseSchema } from './types/users.types.js'

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
