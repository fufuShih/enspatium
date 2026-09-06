import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileErrorMessage, formatFileSize, uploadFile } from '../src/pages/SpacesPage/objectFileApi.ts'

test('uploads raw file bytes with the original MIME type and encoded filename', async (t) => {
  const file = new File([new Uint8Array([0, 255, 128, 10])], 'notes #1.txt', { type: 'text/plain' })
  const signal = new AbortController().signal
  t.mock.method(globalThis, 'fetch', async (url: string, options?: RequestInit) => {
    assert.equal(url, '/api/namespaces/team/spaces/files/objects/notes%20%231.txt')
    assert.equal(options?.body, file)
    assert.equal(new Headers(options?.headers).get('content-type'), 'text/plain')
    assert.equal(options?.credentials, 'include')
    assert.equal(options?.signal, signal)
    return Response.json({ key: file.name }, { status: 201 })
  })
  assert.equal((await uploadFile('team', 'files', file, signal)).key, file.name)
})

test('empty files without a MIME type are sent as binary without adding a body wrapper', async (t) => {
  const file = new File([], 'empty')
  t.mock.method(globalThis, 'fetch', async (_url: string, options?: RequestInit) => {
    assert.equal(new Headers(options?.headers).get('content-type'), 'application/octet-stream')
    assert.ok(options?.body instanceof File)
    assert.equal(options.body.size, 0)
    return Response.json({ key: file.name }, { status: 201 })
  })
  await uploadFile('team', 'files', file, new AbortController().signal)
})

test('file sizes and errors distinguish duplicates, permissions, and storage limits', () => {
  assert.equal(formatFileSize(0), '0 B')
  assert.equal(formatFileSize(1536), '1.5 KiB')
  assert.equal(formatFileSize(100 * 1024 * 1024), '100 MiB')
  assert.match(fileErrorMessage({ status: 409 }, 'upload'), /already exists/)
  assert.match(fileErrorMessage({ status: 403 }, 'upload'), /write access/)
  assert.match(fileErrorMessage({ status: 413 }, 'upload'), /storage space/)
  assert.match(fileErrorMessage({ status: 404 }, 'download'), /no longer available/)
  assert.match(fileErrorMessage(new TypeError('offline'), 'download'), /Please try again/)
})
