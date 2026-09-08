import { expect, test, vi } from 'vitest'
import { fileErrorMessage, formatFileSize, uploadFile } from '../src/pages/SpacesPage/objectFileApi.ts'

test('uploads raw file bytes with the original MIME type and encoded filename', async () => {
  const file = new File([new Uint8Array([0, 255, 128, 10])], 'notes #1.txt', { type: 'text/plain' })
  const signal = new AbortController().signal
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    expect(url).toBe('/api/namespaces/team/spaces/files/objects/notes%20%231.txt')
    expect(options?.body).toBe(file)
    expect(new Headers(options?.headers).get('content-type')).toBe('text/plain')
    expect(options?.credentials).toBe('include')
    expect(options?.signal).toBe(signal)
    return Response.json({ key: file.name }, { status: 201 })
  })
  expect((await uploadFile('team', 'files', file, signal)).key).toBe(file.name)
})

test('empty files without a MIME type are sent as binary without adding a body wrapper', async () => {
  const file = new File([], 'empty')
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
    expect(new Headers(options?.headers).get('content-type')).toBe('application/octet-stream')
    expect(options?.body).toBeInstanceOf(File)
    expect(options?.body).toHaveProperty('size', 0)
    return Response.json({ key: file.name }, { status: 201 })
  })
  await uploadFile('team', 'files', file, new AbortController().signal)
})

test('file sizes and errors distinguish duplicates, permissions, and storage limits', () => {
  expect(formatFileSize(0)).toBe('0 B')
  expect(formatFileSize(1536)).toBe('1.5 KiB')
  expect(formatFileSize(100 * 1024 * 1024)).toBe('100 MiB')
  expect(fileErrorMessage({ status: 409 }, 'upload')).toMatch(/already exists/)
  expect(fileErrorMessage({ status: 403 }, 'upload')).toMatch(/write access/)
  expect(fileErrorMessage({ status: 413 }, 'upload')).toMatch(/storage space/)
  expect(fileErrorMessage({ status: 404 }, 'download')).toMatch(/no longer available/)
  expect(fileErrorMessage(new TypeError('offline'), 'download')).toMatch(/Please try again/)
})
