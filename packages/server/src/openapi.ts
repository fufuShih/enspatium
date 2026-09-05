import swagger from '@fastify/swagger'
import type { FastifyInstance } from 'fastify'

export async function registerOpenApi(app: FastifyInstance) {
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: 'Enspatium API', version: '0.1.0' },
      components: {
        securitySchemes: {
          session: { type: 'apiKey', in: 'cookie', name: 'enspatium_session' },
        },
      },
      security: [{ session: [] }],
    },
    transform: ({ schema, url }) => {
      if (!schema) return { schema: { hide: true }, url }
      // Document raw streams without adding JSON validation to binary routes.
      let documented = { ...schema }
      if (schema.operationId === 'uploadObject') {
        documented = {
          ...documented,
          consumes: ['application/octet-stream'],
          body: { type: 'string', format: 'binary' },
        }
      }
      if (schema.operationId === 'downloadObject') {
        documented = {
          ...documented,
          produces: ['application/octet-stream'],
          response: { 200: { type: 'string', format: 'binary' } },
        }
      }
      if (url.endsWith('/*')) {
        const params = schema.params as {
          properties: Record<string, unknown>
          required: string[]
        }
        const { '*': objectKey, ...properties } = params.properties
        documented.params = {
          ...params,
          properties: { ...properties, objectKey },
          required: params.required.map(key => key === '*' ? 'objectKey' : key),
        }
        url = url.replace(/\/\*$/, '/:objectKey')
      }
      return { schema: documented, url }
    },
  })

  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger())
}
