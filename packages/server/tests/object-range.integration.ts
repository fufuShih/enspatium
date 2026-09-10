import { test, expect, vi } from 'vitest'
import { request as httpRequest } from 'node:http'
import { writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { createFixture } from './fixture.js'
import * as storage from '../src/services/object/storage.js'
import type { PublicNamespace } from '../src/db/namespace.types.js'
import type { PublicSpace } from '../src/db/space.types.js'
import type { PublicSpaceObject } from '../src/db/object.types.js'

test('object streaming supports ranges, conditional reads, HEAD, immutable versions and cancellation with authorization on every request', async ({ onTestFinished }) => {
  const { app, origin, root, session } = await createFixture({ after: cleanup => onTestFinished(cleanup), diagnostic: message => console.info(message) })
  const owner = session()
  const credentials = { email: 'range@example.com', password: 'Range-test-1234' }
  await owner.request('POST', '/users', 201, { ...credentials, displayName: 'Range owner' })
  await owner.request('POST', '/auth/login', 200, credentials)
  const login = await fetch(origin + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials) })
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  await login.arrayBuffer()
  const namespace = (await owner.request<PublicNamespace[]>('GET', '/namespaces')).find(n => n.kind === 'personal')!.slug
  const base = `/namespaces/${namespace}/spaces/ranges`
  const space = await owner.request<PublicSpace>('POST', `/namespaces/${namespace}/spaces`, 201, { name: 'Ranges', slug: 'ranges', type: 'object', visibility: 'public' })
  const current = base + '/objects/media.bin'
  const pinned = (versionId: string) => base + '/object-versions/content?' + new URLSearchParams({ key: 'media.bin', versionId })
  async function upload(bytes: Buffer, key = 'media.bin') {
    const result = await app.inject({ method: 'PUT', url: base + '/objects/' + key, headers: { cookie, 'content-type': 'application/octet-stream' }, payload: bytes })
    expect(result.statusCode, result.body).toBe(201)
    return result.json<PublicSpaceObject>()
  }
  async function read(path: string, status: number, headers: Record<string, string> = {}, method = 'GET') {
    const response = await fetch(origin + path, { method, headers, signal: AbortSignal.timeout(10_000) })
    const bytes = Buffer.from(await response.arrayBuffer())
    expect(response.status).toBe(status)
    return { response, bytes }
  }
  const firstBytes = Buffer.from([0, 1, 2, 3, 4, 128, 200, 253, 254, 255])
  const first = await upload(firstBytes)
  const full = await read(current, 200)
  expect(full.bytes).toEqual(firstBytes)
  expect(full.response.headers.get('accept-ranges')).toBe('bytes')
  expect(full.response.headers.get('content-length')).toBe('10')
  expect(full.response.headers.get('content-type')).toBe('application/octet-stream')
  expect(full.response.headers.get('cache-control')).toBe('private, no-store')
  expect(full.response.headers.get('content-range')).toBeNull()
  const etag = full.response.headers.get('etag')!
  expect(etag).toBe(`"${first.checksumSha256}"`)

  for (const path of [current, pinned(first.versionId)]) {
    for (const [range, start, end] of [['bytes=0-0', 0, 0], ['bytes=2-5', 2, 5], ['bytes=7-', 7, 9], ['bytes=-3', 7, 9], ['bytes=8-9999999999999999999999', 8, 9], ['bytes=-99', 0, 9]] as const) {
      const { response, bytes } = await read(path, 206, { cookie, range })
      expect(bytes).toEqual(firstBytes.subarray(start, end + 1))
      expect(response.headers.get('content-range')).toBe(`bytes ${start}-${end}/10`)
      expect(response.headers.get('content-length')).toBe(String(end - start + 1))
      expect(response.headers.get('etag')).toBe(etag)
      expect(response.headers.get('x-content-sha256')).toBe(first.checksumSha256)
    }
    for (const range of ['bytes=10-', 'bytes=-0', 'bytes=9999999999999999999999-']) {
      const { response, bytes } = await read(path, 416, { cookie, range })
      expect(response.headers.get('content-range')).toBe('bytes */10')
      expect(response.headers.get('content-length')).toBe('0')
      expect(bytes.length).toBe(0)
    }
    for (const range of ['bytes=0-1,4-5', 'bytes=garbage', 'items=1-2', 'bytes=5-2']) {
      expect((await read(path, 200, { cookie, range })).bytes).toEqual(firstBytes)
    }
    expect((await read(path, 206, { cookie, range: 'bytes=2-3', 'if-range': etag })).bytes).toEqual(firstBytes.subarray(2, 4))
    for (const validator of ['"old"', 'W/' + etag, 'Thu, 10 Sep 2026 00:00:00 GMT']) {
      expect((await read(path, 200, { cookie, range: 'bytes=99-', 'if-range': validator })).bytes).toEqual(firstBytes)
    }
  }

  // HEAD and 416 must close the descriptor without allocating a read stream.
  const realOpen = storage.openObjectFile
  const opened: Awaited<ReturnType<typeof realOpen>>[] = []
  vi.spyOn(storage, 'openObjectFile').mockImplementation(async (...args) => {
    const result = await realOpen(...args)
    vi.spyOn(result.file, 'createReadStream')
    opened.push(result)
    return result
  })
  onTestFinished(() => { vi.restoreAllMocks() })
  for (const path of [current, pinned(first.versionId)]) {
    const { response, bytes } = await read(path, 200, { cookie, range: 'bytes=999-' }, 'HEAD')
    expect(bytes.length).toBe(0)
    expect(response.headers.get('content-length')).toBe('10')
    expect(response.headers.get('content-range')).toBeNull()
    expect(response.headers.get('etag')).toBe(etag)
    expect(opened.at(-1)!.file.createReadStream).not.toHaveBeenCalled()
    expect(opened.at(-1)!.file.fd).toBe(-1)
    await read(path, 416, { cookie, range: 'bytes=999-' })
    expect(opened.at(-1)!.file.createReadStream).not.toHaveBeenCalled()
    expect(opened.at(-1)!.file.fd).toBe(-1)
  }

  // Updating the current key must not change the bytes in a pinned URL.
  const secondBytes = Buffer.from('abcdefghij')
  const second = await upload(secondBytes)
  expect((await read(current, 200, { range: 'bytes=2-3', 'if-range': etag })).bytes).toEqual(secondBytes)
  expect((await read(pinned(first.versionId), 206, { cookie, range: 'bytes=2-3', 'if-range': etag })).bytes).toEqual(firstBytes.subarray(2, 4))
  await read(pinned(first.versionId), 401, { range: 'bytes=0-1' })

  await upload(Buffer.alloc(0), 'empty.bin')
  expect((await read(base + '/objects/empty.bin', 200)).bytes.length).toBe(0)
  const emptyRange = await read(base + '/objects/empty.bin', 416, { range: 'bytes=0-' })
  expect(emptyRange.response.headers.get('content-range')).toBe('bytes */0')

  // Disconnect an actual socket while a large response is still streaming.
  await upload(Buffer.alloc(8 * 1024 * 1024, 42), 'large.bin')
  await new Promise<void>((resolve, reject) => {
    const request = httpRequest(origin + base + '/objects/large.bin', { headers: { range: 'bytes=100-' } }, response => {
      expect(response.statusCode).toBe(206)
      response.once('data', () => { response.destroy(); resolve() })
      response.once('error', reject)
    })
    request.setTimeout(10_000, () => request.destroy(new Error('Streaming timeout')))
    request.once('error', reject)
    request.end()
  })
  const cancelled = opened.at(-1)!.file
  await expect.poll(() => cancelled.fd).toBe(-1)
  const cancelledStream = vi.mocked(cancelled.createReadStream).mock.results[0]!.value
  expect(cancelledStream.destroyed).toBe(true)
  expect(cancelledStream.bytesRead).toBeLessThan(8 * 1024 * 1024 - 100)

  // Visibility changes are checked again, before even disclosing range metadata.
  await owner.request('PATCH', base, 200, { visibility: 'private' })
  const openedBeforeDenial = opened.length
  for (const method of ['GET', 'HEAD']) {
    const denied = await read(current, 401, { range: 'bytes=999-' }, method)
    expect(denied.response.headers.get('content-range')).toBeNull()
    expect(denied.response.headers.get('etag')).toBeNull()
    await read(pinned(first.versionId), 401, { range: 'bytes=999-' }, method)
  }
  expect(opened.length).toBe(openedBeforeDenial)
  await read(current, 206, { cookie, range: 'bytes=0-1' })

  const strangerCredentials = { email: 'range-stranger@example.com', password: credentials.password }
  await session().request('POST', '/users', 201, { ...strangerCredentials, displayName: 'Stranger' })
  const strangerLogin = await fetch(origin + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(strangerCredentials) })
  const strangerCookie = strangerLogin.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  await strangerLogin.arrayBuffer()
  for (const path of [current, pinned(first.versionId)]) {
    for (const method of ['GET', 'HEAD']) {
      const denied = await read(path, 403, { cookie: strangerCookie, range: 'bytes=999-' }, method)
      expect(denied.response.headers.get('content-range')).toBeNull()
      expect(denied.response.headers.get('etag')).toBeNull()
    }
  }

  const deleted = await upload(Buffer.from('deleted bytes'), 'deleted.bin')
  await owner.request('DELETE', base + '/objects/deleted.bin?expectedVersion=' + deleted.versionId, 204)
  for (const method of ['GET', 'HEAD']) await read(base + '/objects/deleted.bin', 404, { cookie, range: 'bytes=0-1' }, method)
  const deletedVersion = base + '/object-versions/content?' + new URLSearchParams({ key: 'deleted.bin', versionId: deleted.versionId })
  expect((await read(deletedVersion, 206, { cookie, range: 'bytes=0-2' })).bytes.toString()).toBe('del')

  // A purging version is inaccessible even while its file still exists.
  await app.db.updateTable('space_object_versions').set({ purge_started_at: new Date() }).where('id', '=', first.versionId).execute()
  await read(pinned(first.versionId), 404, { cookie, range: 'bytes=0-1' })
  await read(pinned(first.versionId), 404, { cookie }, 'HEAD')
  const storedPath = join(root, 'data', space.id, second.versionId)
  await writeFile(storedPath, 'short')
  const corrupt = await read(current, 409, { cookie, range: 'bytes=999-' })
  expect(JSON.parse(corrupt.bytes.toString()).code).toBe('OBJECT_CONTENT_CORRUPT')
  expect(corrupt.response.headers.get('content-range')).toBeNull()
  await rename(storedPath, storedPath + '.missing')
  for (const method of ['GET', 'HEAD']) await read(current, 404, { cookie, range: 'bytes=0-1' }, method)
  await rename(join(root, 'data', space.id), join(root, 'data', space.id + '-missing'))
  for (const method of ['GET', 'HEAD']) await read(current, 503, { cookie, range: 'bytes=0-1' }, method)
})
