import type { FastifyRequest } from 'fastify'

import { UserServiceError } from '../services/users.js'

declare module '@fastify/secure-session' {
  interface SessionData {
    userId: string
  }
}

export function requireCurrentUserId(request: FastifyRequest): string {
  const userId = getCurrentUserId(request)

  if (!userId) {
    throw authenticationRequired()
  }

  return userId
}

export function getCurrentUserId(
  request: FastifyRequest,
): string | undefined {
  return request.session.get('userId')
}

export function authenticationRequired(): UserServiceError {
  return new UserServiceError(
    'INVALID_CREDENTIALS',
    401,
    'authentication required',
  )
}
