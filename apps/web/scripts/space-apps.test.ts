import { expect, test, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { compatibleSpaceApps, refreshSpaceApps, spaceAppError } from '../src/pages/SpacesPage/apps/spaceAppsApi'
import { createSpaceApp, deleteSpaceApp, listSpaceApps, updateSpaceApp } from '../src/api/generated/space-apps'
import type { ListApps200Item } from '../src/api/generated/api.schemas'

test('creation offers only registered, installed and storage-compatible app views', () => {
  const app = (type: string, storageType: 'object' | 'git' = 'object'): ListApps200Item => ({ type, storageType, name: type, kind: 'builtin', ownerUserId: null })
  const registry = [app('note'), app('media'), app('ebook'), app('unknown'), app('note', 'git')]
  expect(compatibleSpaceApps(registry, 'object').map(app => app.type)).toEqual(['note', 'media', 'ebook'])
  expect(compatibleSpaceApps(registry, 'git')).toEqual([])
  expect(compatibleSpaceApps([], 'object')).toEqual([])
})

test('management errors are controlled and do not expose server details', () => {
  for (const [status, message] of [[400, 'compatible app'], [401, 'sign in'], [403, 'Space owner'], [404, 'no longer exists'], [500, 'Unable to update']] as const) {
    expect(spaceAppError({ status, message: 'sensitive database detail' })).toContain(message)
    expect(spaceAppError({ status, message: 'sensitive database detail' })).not.toContain('sensitive')
  }
  expect(spaceAppError(new Error('network'))).toContain('Unable to update')
})

test('app mutations refresh Space lists, settings, audit and the selected instance across users', async () => {
  const client = new QueryClient()
  try {
    const base = '/api/namespaces/owner/spaces/demo'
    const affected = [[base, 'owner'], [base + '/apps', 'owner'], [base + '/apps', null], [base + '/audit-events', 'owner'],
      ['/api/namespaces/owner/spaces', 'owner'], ['app-instance', 'note', 'first', 'owner'], ['app-instance', 'note', 'first', null]]
    const unaffected = [[base + '-other/apps', 'owner'], ['app-instance', 'note', 'second', 'owner'], ['app-instance', 'media', 'first', 'owner']]
    for (const key of [...affected, ...unaffected]) client.setQueryData(key, {})
    await refreshSpaceApps(client, 'owner', 'demo', { id: 'first', appType: 'note' })
    for (const key of affected) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    for (const key of unaffected) expect(client.getQueryState(key)?.isInvalidated).toBe(false)
  } finally { client.clear() }
})

test('generated management clients encode IDs, send credentials and accept empty deletion responses', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ id: 'app-id' }))
  const signal = new AbortController().signal
  const base = '/api/namespaces/a%2Fb/spaces/a%20%23/apps'
  await listSpaceApps('a/b', 'a #', { signal })
  expect(fetch).toHaveBeenLastCalledWith(base, expect.objectContaining({ method: 'GET', signal, credentials: 'include' }))
  await createSpaceApp('a/b', 'a #', { appType: 'note', name: 'Notebook' }, { signal })
  expect(fetch).toHaveBeenLastCalledWith(base, expect.objectContaining({ method: 'POST', signal, credentials: 'include', body: JSON.stringify({ appType: 'note', name: 'Notebook' }) }))
  await updateSpaceApp('a/b', 'a #', 'app/id', { name: 'New name' })
  expect(fetch).toHaveBeenLastCalledWith(base + '/app%2Fid', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: 'New name' }) }))
  fetch.mockResolvedValue(new Response(null, { status: 204 }))
  expect(await deleteSpaceApp('a/b', 'a #', 'app/id')).toBeUndefined()
  expect(fetch).toHaveBeenLastCalledWith(base + '/app%2Fid', expect.objectContaining({ method: 'DELETE', credentials: 'include' }))
})
