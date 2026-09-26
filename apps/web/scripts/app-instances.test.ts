import { afterEach, expect, test, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { createObjectAppIntegration } from '../src/pages/AppPages/objectIntegration'
import { appPath } from '../src/pages/AppPages/paths'
import { downloadAppInstanceContent, headAppInstanceContent, getListAppInstanceObjectsQueryKey } from '../src/api/generated/app-objects'
import { refreshObjectLists } from '../src/pages/SpacesPage/object/objectFileApi'

afterEach(() => vi.restoreAllMocks())

test('App links use the instance ID, with stable root and encoded child segments', () => {
  expect(appPath('note', 'instance-id')).toBe('/app/note/instance-id/')
  expect(appPath('ebook', 'instance-id', 'book', 'a/b #')).toBe('/app/ebook/instance-id/book/a%2Fb%20%23')
})

test('generated instance loaders and streams use instance routes and session credentials', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ id: 'app-id', spaceId: 'different-space-id' }))
  const integration = createObjectAppIntegration('note')
  const signal = new AbortController().signal
  expect(await integration.loadInstance('app-id', signal)).toMatchObject({ id: 'app-id', spaceId: 'different-space-id' })
  expect(fetch).toHaveBeenLastCalledWith('/api/apps/note/instances/app-id', expect.objectContaining({ signal, credentials: 'include' }))
  const params = { key: 'folder/a #.md', versionId: 'version-id' }
  expect(integration.contentUrl('app-id', params)).toBe('/api/apps/note/instances/app-id/objects/content?key=folder%2Fa+%23.md&versionId=version-id')
  fetch.mockResolvedValue(new Response('# Note'))
  expect(await (await downloadAppInstanceContent('note', 'app-id', params)).text()).toBe('# Note')
  fetch.mockResolvedValue(new Response(null, { headers: { 'content-length': '6' } }))
  expect(await headAppInstanceContent('note', 'app-id', params)).toBeUndefined()
  expect(fetch).toHaveBeenLastCalledWith(integration.contentUrl('app-id', params), expect.objectContaining({ method: 'HEAD', credentials: 'include' }))
  expect(integration.listQueryKey('first')).not.toEqual(integration.listQueryKey('second'))
})

test('file mutations refresh all App instance lists for their Space, not unrelated Spaces', async () => {
  const client = new QueryClient()
  const first = getListAppInstanceObjectsQueryKey('note', 'first')
  const second = getListAppInstanceObjectsQueryKey('note', 'second')
  const other = getListAppInstanceObjectsQueryKey('note', 'other')
  for (const key of [first, second, other]) {
    client.setQueryDefaults(key, { meta: { appObjectSpace: key === other ? 'team/other' : 'team/shared' } })
    client.setQueryData(key, { objects: [] })
  }
  await refreshObjectLists(client, 'team', 'shared')
  expect(client.getQueryState(first)?.isInvalidated).toBe(true)
  expect(client.getQueryState(second)?.isInvalidated).toBe(true)
  expect(client.getQueryState(other)?.isInvalidated).toBe(false)
  client.clear()
})
