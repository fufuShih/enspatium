import { expect, test, vi } from 'vitest'
import { moveObject } from '../src/api/generated/objects.ts'
import { objectMoveKey } from '../src/pages/SpacesPage/objectMoveApi.ts'

test('renaming keeps the parent; moving keeps the filename and supports root or nested destinations', () => {
  expect(objectMoveKey('docs/book.pdf', 'rename', '中文 #%.pdf')).toBe('docs/中文 #%.pdf')
  expect(objectMoveKey('docs/book.pdf', 'move', 'library/new/')).toBe('library/new/book.pdf')
  expect(objectMoveKey('docs/book.pdf', 'move', '')).toBe('book.pdf')
  for (const value of ['../bad', '/absolute', 'a//b', 'a\\b', 'a/../b', 'CON', 'a.']) {
    expect(objectMoveKey('book.pdf', 'move', value), value).toBeNull()
    expect(objectMoveKey('book.pdf', 'rename', value), value).toBeNull()
  }
  expect(objectMoveKey('book.pdf', 'move', '/')).toBeNull()
  expect(objectMoveKey('book.pdf', 'rename', '')).toBeNull()
  expect(objectMoveKey('book.pdf', 'move', 'a'.repeat(1024))).toBeNull()
})

test('the generated move client preserves source identity, version and literal destination characters', async () => {
  const params = { objectId: 'object-id', key: 'docs/a #%.txt', newKey: '中文/new #%.txt', expectedVersion: 'original-version' }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    const url = new URL(String(input), 'https://example.test')
    expect(url.pathname).toBe('/api/namespaces/owner/spaces/files/object-move')
    expect(Object.fromEntries(url.searchParams)).toEqual(params)
    expect(options?.method).toBe('POST')
    expect(options?.credentials).toBe('include')
    return Response.json({ key: params.newKey, id: params.objectId, versionId: params.expectedVersion })
  })
  expect(await moveObject('owner', 'files', params)).toMatchObject({ key: params.newKey })
})
