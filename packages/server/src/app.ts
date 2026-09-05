import helmet from '@fastify/helmet'
import secureSession from '@fastify/secure-session'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import Fastify from 'fastify'

import { configPlugin } from './config.js'
import { dbPlugin } from './db/index.js'
import { registerOpenApi } from './openapi.js'
import { registerRoutes } from './routes/index.js'
import { initializeStorage } from './services/space/storage.js'

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
  await registerOpenApi(app)
  await registerRoutes(app)

  return app
}
