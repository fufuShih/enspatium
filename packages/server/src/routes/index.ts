import type { FastifyInstance } from 'fastify'

import { auditRoutes } from './audit.route.js'
import { authRoutes } from './auth.route.js'
import { gitRoutes } from './git.route.js'
import { healthRoutes } from './health.route.js'
import { namespaceRoutes } from './namespaces.route.js'
import { objectRoutes } from './objects.route.js'
import { spaceRoutes } from './spaces.route.js'
import { tokenRoutes } from './tokens.route.js'
import { userRoutes } from './users.route.js'

// Runtime and OpenAPI export register the same routes.
export async function registerRoutes(app: FastifyInstance) {
  await app.register(healthRoutes)
  await app.register(userRoutes)
  await app.register(authRoutes)
  await app.register(tokenRoutes)
  await app.register(gitRoutes)
  await app.register(namespaceRoutes)
  await app.register(spaceRoutes)
  await app.register(auditRoutes)
  await app.register(objectRoutes)
}
