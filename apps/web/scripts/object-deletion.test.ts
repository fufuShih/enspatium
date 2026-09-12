import { expect, test, vi } from 'vitest'
import { deleteSelectedObject } from '../src/pages/SpacesPage/objectDeletion.ts'

const target = { id: 'object-id', key: 'docs/中文 #%.txt', versionId: 'original-version' }
const controller = () => new AbortController()

test('deletion uses the selected version as an atomic precondition and encodes the exact key', async () => {
  const signal = controller().signal
  const calls: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'https://example.test')
    expect(init?.signal).toBe(signal)
    expect(init?.credentials).toBe('include')
    calls.push(init?.method || 'GET')
    if (init?.method === 'DELETE') {
      expect(decodeURIComponent(url.pathname)).toBe('/api/namespaces/owner/spaces/files/objects/' + target.key)
      expect(url.searchParams.get('expectedVersion')).toBe(target.versionId)
      return new Response(null, { status: 204 })
    }
    expect(url.searchParams.get('key')).toBe(target.key)
    return Response.json({ ...target, isDeleted: false })
  })
  await deleteSelectedObject('owner', 'files', target, signal)
  expect(calls).toEqual(['GET', 'DELETE'])
})

test('retry after a lost successful response recognizes deletion without another write', async () => {
  let deleted = false
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    if (init?.method === 'DELETE') { deleted = true; throw new TypeError('Response lost') }
    return Response.json({ ...target, versionId: deleted ? 'deletion-marker' : target.versionId, isDeleted: deleted })
  })
  await expect(deleteSelectedObject('owner', 'files', target, controller().signal)).rejects.toThrow('Response lost')
  await expect(deleteSelectedObject('owner', 'files', target, controller().signal)).resolves.toBe('Already in Deleted files.')
  expect(fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1)
})

test('changed, restored, replaced and missing objects cannot be deleted using an old selection', async () => {
  for (const current of [
    { ...target, versionId: 'newer-version', isDeleted: false },
    { ...target, versionId: 'restored-version', isDeleted: false },
    { ...target, id: 'replacement', isDeleted: true },
    null,
  ]) {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(current))
    await expect(deleteSelectedObject('owner', 'files', target, controller().signal)).rejects.toMatchObject({ status: current?.id === target.id ? 409 : 404 })
    expect(fetch).toHaveBeenCalledTimes(1)
    fetch.mockRestore()
  }
})

test('a write racing after the head check still receives the original version and surfaces conflict', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    if (init?.method === 'DELETE') return Response.json({ message: 'Changed' }, { status: 409 })
    return Response.json({ ...target, isDeleted: false })
  })
  await expect(deleteSelectedObject('owner', 'files', target, controller().signal)).rejects.toMatchObject({ status: 409 })
})

test('stopping after the head check prevents a deletion request', async () => {
  const abort = controller()
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    abort.abort()
    return Response.json({ ...target, isDeleted: false })
  })
  await expect(deleteSelectedObject('owner', 'files', target, abort.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(fetch).toHaveBeenCalledTimes(1)
})
