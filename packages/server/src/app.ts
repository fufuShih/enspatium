import helmet from '@fastify/helmet'
import secureSession from '@fastify/secure-session'
import rateLimit from '@fastify/rate-limit'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import Fastify from 'fastify'

import { configPlugin } from './config.js'
import { dbPlugin } from './db/index.js'
import { registerOpenApi } from './openapi.js'
import { registerRoutes } from './routes/index.js'
import { initializeStorage } from './services/space/storage.js'
import { registerSessionAccess } from './services/session-access.js'
import { configureGitConcurrency } from './services/git/process.js'
import { registerOperations } from './services/operations.js'
import { registerGitMaintenance } from './services/git/maintenance.js'

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

export async function buildApp() {
  const proxy = { enabled: false }
  const app = Fastify({
    logger: { redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'] },
    // Trust exactly the adjacent reverse proxy, only when explicitly configured.
    trustProxy: (_address, hop) => proxy.enabled && hop === 0,
  }).withTypeProvider<TypeBoxTypeProvider>()

  await app.register(configPlugin)
  configureGitConcurrency(app.config.GIT_MAX_CONCURRENT_PROCESSES)
  proxy.enabled = app.config.TRUST_PROXY
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => ({ statusCode: 429, code: 'RATE_LIMITED', error: 'Too Many Requests', message: 'Too many attempts. Please try again later.' }),
  })
  await initializeStorage(app.config.DATA_ROOT)
  await app.register(dbPlugin)
  registerOperations(app)
  registerGitMaintenance(app)
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
  registerSessionAccess(app)
  await registerOpenApi(app)
  await registerRoutes(app)

  return app
}
