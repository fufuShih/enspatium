import helmet from '@fastify/helmet'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import Fastify from 'fastify'

import { configPlugin } from './config.js'
import { dbPlugin } from './db/index.js'
import { healthRoutes } from './routes/health.js'

export async function buildApp() {
  const app = Fastify({ logger: true }).withTypeProvider<TypeBoxTypeProvider>()

  await app.register(configPlugin)
  await app.register(dbPlugin)
  await app.register(helmet)
  await app.register(healthRoutes)

  return app
}
