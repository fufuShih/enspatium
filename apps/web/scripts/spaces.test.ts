import { expect, test } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { CreateSpace201, ListNamespaces200Item } from '../src/api/generated/api.schemas.ts'
import { getGetSpaceQueryKey, getListSpacesQueryKey } from '../src/api/generated/spaces.ts'
import { cacheCreatedSpace, creatableNamespaces, makeSpaceSlug, spaceErrorMessage, spacePath } from '../src/pages/SpacesPage/shared/spaceApi.ts'
import { authReturnPath } from '../src/context/session.ts'

const created: CreateSpace201 = { app: null, objectVersionLimit: 3, objectRetentionDays: 7, id: 'space-id', namespaceId: 'namespace-id', createdByUserId: 'owner-id', name: 'My Project', slug: 'my-project', type: 'git', visibility: 'private', createdAt: '', updatedAt: '' }

test('creation updates only the correct account and user caches and marks its list stale', async () => {
  const client = new QueryClient()
  try {
    const key = [...getListSpacesQueryKey('owner'), 'owner-id']
    const otherAccount = [...getListSpacesQueryKey('team'), 'owner-id']
    const otherUser = [...getListSpacesQueryKey('owner'), 'other-user']
    client.setQueryData(key, [])
    client.setQueryData(otherAccount, [])
    client.setQueryData(otherUser, [])
    await cacheCreatedSpace(client, 'owner', 'owner-id', created)
    await cacheCreatedSpace(client, 'owner', 'owner-id', created)
    expect(client.getQueryData(key)).toStrictEqual([created])
    expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    expect(client.getQueryData(otherAccount)).toStrictEqual([])
    expect(client.getQueryData(otherUser)).toStrictEqual([])
    expect(client.getQueryData([...getGetSpaceQueryKey('owner', created.slug), 'owner-id'])).toStrictEqual(created)
    expect(client.getQueryData([...getGetSpaceQueryKey('owner', created.slug), null])).toBe(undefined)
  } finally { client.clear() }
})

test('creation does not invent a partial list when the list has not loaded', async () => {
  const client = new QueryClient()
  try {
    await cacheCreatedSpace(client, 'owner', 'owner-id', created)
    expect(client.getQueryData([...getListSpacesQueryKey('owner'), 'owner-id'])).toBe(undefined)
  } finally { client.clear() }
})

test('the Owner menu excludes organizations where the user is only a member', () => {
  const namespaces: ListNamespaces200Item[] = [
    { id: 'personal', ownerUserId: 'me', name: 'Me', slug: 'my-account', kind: 'personal', createdAt: '' },
    { id: 'owned-team', ownerUserId: 'me', name: 'My Team', slug: 'my-team', kind: 'organization', createdAt: '' },
    { id: 'other-team', ownerUserId: 'someone-else', name: 'Other Team', slug: 'other-team', kind: 'organization', createdAt: '' },
  ]
  expect(creatableNamespaces(namespaces, 'me').map(item => item.id)).toStrictEqual(['personal', 'owned-team'])
})

test('suggested slugs follow backend rules and routes encode their components', () => {
  expect(makeSpaceSlug('  My New_Project!!  ')).toBe('my-new-project')
  expect(makeSpaceSlug('a'.repeat(39) + ' more')).toBe('a'.repeat(39))
  expect(makeSpaceSlug('中文')).toBe('')
  expect(spacePath('my team', 'files#1')).toBe('/my%20team/files%231')
  expect(spaceErrorMessage({ status: 409 })).toMatch(/already used/)
  expect(spaceErrorMessage({ status: 403 })).toMatch(/permission/)
})

test('login returns to internal Space URLs and rejects external URLs and auth loops', () => {
  expect(authReturnPath('/owner/private-space')).toBe('/owner/private-space')
  expect(authReturnPath('/space/create?owner=team')).toBe('/space/create?owner=team')
  for (const path of ['//example.com', 'https://example.com', '/\\example.com', '/login', '/register?from=/login', null]) expect(authReturnPath(path)).toBe(undefined)
})
