import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { sql } from 'kysely'

const HealthResponse = Type.Object({
  status: Type.Literal('ok'),
})

export const healthRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        response: {
          200: HealthResponse,
        },
      },
    },
    async () => ({ status: 'ok' as const }),
  )

  app.get(
    '/health/db',
    {
      schema: {
        response: {
          200: HealthResponse,
        },
      },
    },
    async () => {
      await sql`select 1`.execute(app.db)

      return { status: 'ok' as const }
    },
  )
}
