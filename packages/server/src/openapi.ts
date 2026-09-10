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
    transform: ({ schema, url, route }) => {
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
      const operationId = schema.operationId?.replace(/-head$/, '')
      if (operationId === 'downloadObject' || operationId === 'downloadObjectVersion') {
        const headers = {
          'accept-ranges': { type: 'string', enum: ['bytes'] },
          'content-length': { type: 'integer', minimum: 0 },
          etag: { type: 'string', description: 'Strong SHA-256 entity tag for the full content.' },
          'cache-control': { type: 'string' },
          'x-content-sha256': { type: 'string', description: 'Checksum of the full object, including for partial responses.' },
        }
        documented = {
          ...documented,
          description: 'Stream object content. Supports single byte ranges (start-end, start-, -suffix). Unsupported, malformed and multiple ranges return the full 200 response. If-Range requires the exact strong ETag; other validators return 200. HEAD uses the same authorization and full-content headers without a body, ignoring Range. Every request rechecks access and version availability.',
          headers: { type: 'object', properties: {
            range: { type: 'string', description: 'Single byte range, for example bytes=0-1023.' },
            'if-range': { type: 'string', description: 'Strong ETag from a previous response. HTTP-date validators fall back to full content.' },
          } },
          produces: ['application/octet-stream'],
          response: {
            200: { type: 'string', format: 'binary', description: 'Full content', headers },
            206: { type: 'string', format: 'binary', description: 'Partial content', headers: {
              ...headers, 'content-range': { type: 'string', description: 'bytes start-end/size' },
            } },
            416: { type: 'null', description: 'Unsatisfiable range; empty body', headers: {
              ...headers, 'content-range': { type: 'string', description: 'bytes */size' },
            } },
          },
        }
        if (route.method === 'HEAD') {
          documented.operationId = operationId === 'downloadObject' ? 'headObjectContent' : 'headObjectVersionContent'
          documented.description = 'Return full-content headers without reading a response body. Uses the same authorization and version availability checks as GET; ignores Range.'
          delete documented.headers
          documented.response = { 200: { type: 'null', description: 'Full-content headers; no body', headers } }
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
