import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSpace, downloadObject, listSpaces, logout, uploadObject } from '../src/api/generated.ts'

test('generated client sends JSON, session credentials, and encoded paths', async (t) => {
  const calls: { url: string; options?: RequestInit }[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, options?: RequestInit) => {
    calls.push({ url, options })
    return Response.json(options?.method === 'POST' ? { slug: 'demo' } : [])
  })
  assert.deepEqual(await listSpaces('my team'), [])
  assert.equal(calls[0].url, '/api/namespaces/my%20team/spaces')
  assert.equal(calls[0].options?.credentials, 'include')
  const body = { name: 'Demo', slug: 'demo', type: 'git' as const }
  assert.equal((await createSpace('team', body)).slug, 'demo')
  assert.equal(calls[1].options?.method, 'POST')
  assert.deepEqual(JSON.parse(calls[1].options?.body as string), body)
})

test('generated client handles binary content, no content, and failed responses', async (t) => {
  const blob = new Blob(['file contents'])
  const fetch = t.mock.method(globalThis, 'fetch', async (_url: string, options?: RequestInit) => {
    assert.equal(options?.body, blob)
    return Response.json({ key: 'folder/a #.txt' }, { status: 201 })
  })
  await uploadObject('team', 'files', 'folder/a #.txt', blob)
  assert.equal(fetch.mock.calls[0].arguments[0], '/api/namespaces/team/spaces/files/objects/folder%2Fa%20%23.txt')
  fetch.mock.mockImplementation(async () => new Response(blob))
  assert.equal(await (await downloadObject('team', 'files', 'a.txt')).text(), 'file contents')
  fetch.mock.mockImplementation(async () => new Response(null, { status: 204 }))
  assert.equal(await logout(), undefined)
  fetch.mock.mockImplementation(async () => Response.json({ message: 'Unauthorized' }, { status: 401 }))
  await assert.rejects(listSpaces('team'), { status: 401, info: { message: 'Unauthorized' } })
})
