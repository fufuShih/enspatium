import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'

import {
  UserServiceError,
  authenticateUser,
  getUser,
} from '../services/users.js'
import { UserResponseSchema } from './users.js'

declare module '@fastify/secure-session' {
  interface SessionData {
    userId: string
  }
}

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
      const userId = request.session.get('userId')

      if (!userId) {
        throw authenticationRequired()
      }

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

function authenticationRequired(): UserServiceError {
  return new UserServiceError(
    'INVALID_CREDENTIALS',
    401,
    'authentication required',
  )
}
