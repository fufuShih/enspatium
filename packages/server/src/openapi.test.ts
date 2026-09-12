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
    for (const operation of [objects.get, document.paths['/namespaces/{namespaceSlug}/spaces/{spaceSlug}/object-versions/content'].get]) {
      for (const status of ['200', '206']) {
        expect(operation.responses[status].content['application/octet-stream'].schema).toMatchObject({ type: 'string', format: 'binary' })
        expect(operation.responses[status].headers['accept-ranges'].schema.enum).toEqual(['bytes'])
      }
      expect(operation.responses['416'].content).toBeUndefined()
      expect(operation.responses['416'].headers['content-range']).toBeDefined()
      expect(operation.parameters).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'range', in: 'header', required: false }),
        expect.objectContaining({ name: 'if-range', in: 'header', required: false }),
      ]))
    }
    expect(objects.get.parameters.some((parameter: { name: string }) => parameter.name === 'objectKey')).toBe(true)
    expect(objects.head.operationId).toBe('headObjectContent')
    expect(objects.head.responses['200'].content).toBeUndefined()
    expect(document.paths['/namespaces/{namespaceSlug}/spaces/{spaceSlug}/object-versions/content'].head.operationId).toBe('headObjectVersionContent')
    const gitRaw = document.paths['/namespaces/{namespaceSlug}/spaces/{spaceSlug}/git/raw']
    expect(gitRaw.get.responses['200'].content['application/octet-stream'].schema).toEqual({ type: 'string', format: 'binary' })
    expect(gitRaw.get.responses['200'].headers['x-git-commit']).toBeDefined()
    expect(gitRaw.head.operationId).toBe('headGitSpaceRawFile')
    expect(gitRaw.head.responses['200'].content).toBeUndefined()
    expect(gitRaw.get.parameters).toContainEqual(expect.objectContaining({ name: 'download', in: 'query', required: false }))
    const archive = document.paths['/namespaces/{namespaceSlug}/spaces/{spaceSlug}/git/archive']
    expect(archive.get.responses['200'].content['application/zip'].schema).toEqual({ type: 'string', format: 'binary' })
    expect(archive.get.responses['200'].headers['x-git-commit']).toBeDefined()
    expect(archive.get.responses['200'].headers['content-length']).toBeUndefined()
    expect(archive.head.operationId).toBe('headGitSpaceArchive')
    expect(archive.head.responses['200'].content).toBeUndefined()
  } finally {
    await app.close()
  }
})
