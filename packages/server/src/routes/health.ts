import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'

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
}
