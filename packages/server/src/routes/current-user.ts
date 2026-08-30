import type { FastifyRequest } from 'fastify'

import { UserServiceError } from '../services/users.js'

declare module '@fastify/secure-session' {
  interface SessionData {
    userId: string
  }
}

export function requireCurrentUserId(request: FastifyRequest): string {
  const userId = request.session.get('userId')

  if (!userId) {
    throw authenticationRequired()
  }

  return userId
}

export function authenticationRequired(): UserServiceError {
  return new UserServiceError(
    'INVALID_CREDENTIALS',
    401,
    'authentication required',
  )
}
