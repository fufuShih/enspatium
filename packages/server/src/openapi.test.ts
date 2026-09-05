import Fastify from 'fastify'
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { registerOpenApi } from './openapi.js'
import { registerRoutes } from './routes/index.js'

it('exports the current REST contract without configuration or a database', async () => {
  const app = Fastify()
  try {
    await registerOpenApi(app)
    await registerRoutes(app)
    const response = await app.inject('/openapi.json')
    expect(response.statusCode).toBe(200)
    const document = response.json()
    expect(document).toEqual(JSON.parse(await readFile(new URL('../openapi.json', import.meta.url), 'utf8')))
    expect(document.openapi).toBe('3.1.0')
    expect(document.paths['/openapi.json']).toBeUndefined()
    expect(Object.keys(document.paths).some(path => path.includes('.git'))).toBe(false)
    const operations = Object.values(document.paths).flatMap(path => Object.values(path as object))
    const ids = operations.map(operation => operation.operationId)
    expect(ids.every(Boolean)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('createSpace')
    expect(ids).toContain('listSpaces')
    expect(document.paths['/auth/logout'].post.responses['204'].content).toBeUndefined()
    expect(document.paths['/auth/login'].post.security).toEqual([])
    const objects = document.paths['/namespaces/{namespaceSlug}/spaces/{spaceSlug}/objects/{objectKey}']
    expect(objects.put.requestBody.content['application/octet-stream'].schema).toEqual({ type: 'string', format: 'binary' })
    expect(objects.get.responses['200'].content['application/octet-stream'].schema).toEqual({ type: 'string', format: 'binary' })
    expect(objects.get.parameters.some((parameter: { name: string }) => parameter.name === 'objectKey')).toBe(true)
  } finally {
    await app.close()
  }
})
