import { expect, test, vi } from 'vitest'
import { logout } from '../src/api/generated/auth.ts'
import { downloadObject, uploadObject } from '../src/api/generated/objects.ts'
import { createSpace, listSpaces } from '../src/api/generated/spaces.ts'

test('generated client sends JSON, session credentials, and encoded paths', async () => {
  const calls: { url: string; options?: RequestInit }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    calls.push({ url: String(url), options })
    return Response.json(options?.method === 'POST' ? { slug: 'demo' } : [])
  })
  expect(await listSpaces('my team')).toStrictEqual([])
  expect(calls[0].url).toBe('/api/namespaces/my%20team/spaces')
  expect(calls[0].options?.credentials).toBe('include')
  const body = { name: 'Demo', slug: 'demo', type: 'git' as const }
  expect((await createSpace('team', body)).slug).toBe('demo')
  expect(calls[1].options?.method).toBe('POST')
  expect(JSON.parse(calls[1].options?.body as string)).toStrictEqual(body)
})

test('generated client handles binary content, no content, and failed responses', async () => {
  const blob = new Blob(['file contents'])
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
    expect(options?.body).toBe(blob)
    return Response.json({ key: 'folder/a #.txt' }, { status: 201 })
  })
  await uploadObject('team', 'files', 'folder/a #.txt', blob)
  expect(fetch.mock.calls[0][0]).toBe('/api/namespaces/team/spaces/files/objects/folder%2Fa%20%23.txt')
  fetch.mockImplementation(async () => new Response(blob))
  expect(await (await downloadObject('team', 'files', 'a.txt')).text()).toBe('file contents')
  fetch.mockImplementation(async () => new Response(null, { status: 204 }))
  expect(await logout()).toBe(undefined)
  fetch.mockImplementation(async () => Response.json({ message: 'Unauthorized' }, { status: 401 }))
  await expect(listSpaces('team')).rejects.toMatchObject({ status: 401, info: { message: 'Unauthorized' } })
})
