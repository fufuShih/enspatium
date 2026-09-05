import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { sql } from 'kysely'

import { HealthResponseSchema } from './types/health.types.js'

export const healthRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        operationId: 'getHealth',
        tags: ['health'],
        security: [],
        response: {
          200: HealthResponseSchema,
        },
      },
    },
    async () => ({ status: 'ok' as const }),
  )

  app.get(
    '/health/db',
    {
      schema: {
        operationId: 'getDatabaseHealth',
        tags: ['health'],
        security: [],
        response: {
          200: HealthResponseSchema,
        },
      },
    },
    async () => {
      await sql`select 1`.execute(app.db)

      return { status: 'ok' as const }
    },
  )
}
