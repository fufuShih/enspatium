import { Type } from '@sinclair/typebox'
import { createHash } from 'node:crypto'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'

import {
  UserServiceError,
  authenticateUser,
  getSessionUser,
} from '../services/users.js'
import {
  authenticationRequired,
  requireCurrentUserId,
} from './current-user.route.js'
import { LoginBodySchema, SessionUserResponseSchema } from './types/auth.types.js'

export const authRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get('/auth/settings', {
    schema: { operationId: 'getAuthSettings', tags: ['auth'], security: [], response: { 200: Type.Object({ registrationEnabled: Type.Boolean() }) } },
  }, async (_request, reply) => {
    reply.header('cache-control', 'no-store')
    return { registrationEnabled: app.config?.REGISTRATION_ENABLED !== false }
  })

  const accountThrottle = app.createRateLimit?.({
    max: () => app.config.LOGIN_ACCOUNT_RATE_LIMIT,
    timeWindow: '1 minute',
    keyGenerator: request => {
      const body = request.body as { email?: string } | undefined
      return createHash('sha256').update(body?.email?.trim().toLowerCase() ?? '').digest('hex')
    },
  })
  app.post(
    '/auth/login',
    {
      config: { rateLimit: { max: () => app.config.LOGIN_RATE_LIMIT, timeWindow: '1 minute' } },
      preHandler: async (request, reply) => {
        // Use the low-level limiter: the route's IP limiter has already run,
        // and two rateLimit() hooks would otherwise share its already-run flag.
        const budget = await accountThrottle?.(request)
        if (budget && !budget.isAllowed && budget.isExceeded) {
          reply.header('retry-after', budget.ttlInSeconds)
          throw Object.assign(new Error('Too many attempts. Please try again later.'), { statusCode: 429, code: 'RATE_LIMITED' })
        }
      },
      schema: {
        operationId: 'login',
        tags: ['auth'],
        security: [],
        body: LoginBodySchema,
        response: {
          200: SessionUserResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header('cache-control', 'private, no-store')
      const user = await authenticateUser(
        app.db,
        request.body.email,
        request.body.password,
      )

      request.session = app.createSecureSession({})
      request.session.set('userId', user.id)
      request.session.set('sessionVersion', user.sessionVersion)

      return user
    },
  )

  app.get(
    '/auth/me',
    {
      schema: {
        operationId: 'getCurrentUser',
        tags: ['auth'],
        response: {
          200: SessionUserResponseSchema,
        },
      },
    },
    async (request, reply) => {
      reply.header('cache-control', 'private, no-store')
      const userId = requireCurrentUserId(request)

      try {
        return await getSessionUser(app.db, userId)
      } catch (error) {
        if (error instanceof UserServiceError && error.code === 'NOT_FOUND') {
          request.session.delete()
          throw authenticationRequired()
        }

        throw error
      }
    },
  )

  app.post(
    '/auth/logout',
    {
      schema: {
        operationId: 'logout',
        tags: ['auth'],
        security: [],
        response: { 204: Type.Null() },
      },
    },
    async (request, reply) => {
      request.session.delete()

      return reply.code(204).send(null)
    },
  )
}
