import helmet from '@fastify/helmet'
import secureSession from '@fastify/secure-session'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import Fastify from 'fastify'

import { configPlugin } from './config.js'
import { dbPlugin } from './db/index.js'
import { auditRoutes } from './routes/audit.js'
import { authRoutes } from './routes/auth.js'
import { gitRoutes } from './routes/git.js'
import { healthRoutes } from './routes/health.js'
import { namespaceRoutes } from './routes/namespaces.js'
import { objectRoutes } from './routes/objects.js'
import { spaceRoutes } from './routes/spaces.js'
import { initializeStorage } from './services/space/storage.js'
import { tokenRoutes } from './routes/tokens.js'
import { userRoutes } from './routes/users.js'

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

export async function buildApp() {
  const app = Fastify({ logger: true }).withTypeProvider<TypeBoxTypeProvider>()

  await app.register(configPlugin)
  await initializeStorage(app.config.DATA_ROOT)
  await app.register(dbPlugin)
  await app.register(secureSession, {
    key: Buffer.from(app.config.SESSION_KEY, 'hex'),
    cookieName: 'enspatium_session',
    expiry: SESSION_MAX_AGE_SECONDS,
    cookie: {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: app.config.SESSION_SECURE,
      maxAge: SESSION_MAX_AGE_SECONDS,
    },
  })
  await app.register(helmet)
  await app.register(healthRoutes)
  await app.register(userRoutes)
  await app.register(authRoutes)
  await app.register(tokenRoutes)
  await app.register(gitRoutes)
  await app.register(namespaceRoutes)
  await app.register(spaceRoutes)
  await app.register(auditRoutes)
  await app.register(objectRoutes)

  return app
}
