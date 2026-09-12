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
      if (operationId === 'downloadGitSpaceArchive') {
        const headers = {
          'content-disposition': { type: 'string' },
          'cache-control': { type: 'string' },
          'x-git-commit': { type: 'string', description: 'Commit ID resolved before generating the ZIP.' },
        }
        documented = {
          ...documented,
          description: 'Download a ZIP of the whole repository at ref (defaults to HEAD), resolved once to a commit ID. Includes a repository-slug/short-commit root directory and honors Git export attributes. Excludes Git history and submodule contents. Checks Space read access on every request. Streams without a Content-Length, disk cache, or Range support; disconnects stop archive generation. HEAD checks access and ref without generating a ZIP.',
          produces: ['application/zip'],
          response: { 200: { type: 'string', format: 'binary', headers } },
        }
        if (route.method === 'HEAD') {
          documented.operationId = 'headGitSpaceArchive'
          documented.response = { 200: { type: 'null', description: 'Archive headers; no body or content length', headers } }
        }
      }
      if (operationId === 'getGitSpaceRawFile') {
        const headers = {
          'content-length': { type: 'integer', minimum: 0 },
          'content-disposition': { type: 'string' },
          'cache-control': { type: 'string' },
          'x-git-commit': { type: 'string', description: 'Resolved commit ID used for this response.' },
        }
        documented = {
          ...documented,
          description: 'Stream exact Git blob bytes at ref and path. Raw is served as plain text without HTML execution; download=true returns an attachment. No preview size limit. Every request checks Space read access. HEAD returns headers only. Range requests are not supported.',
          produces: ['application/octet-stream', 'text/plain'],
          response: { 200: { type: 'string', format: 'binary', headers } },
        }
        if (route.method === 'HEAD') {
          documented.operationId = 'headGitSpaceRawFile'
          documented.response = { 200: { type: 'null', description: 'File headers; no body', headers } }
        }
      }
      if (operationId === 'downloadObject' || operationId === 'downloadObjectVersion' || operationId === 'downloadAppContent') {
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
          documented.operationId = operationId === 'downloadObject' ? 'headObjectContent' : operationId === 'downloadAppContent' ? 'headAppContent' : 'headObjectVersionContent'
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
