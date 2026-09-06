import assert from 'node:assert/strict'
import { test } from 'node:test'
import { QueryClient } from '@tanstack/react-query'
import type { CreateSpace201, ListNamespaces200Item } from '../src/api/generated/api.schemas.ts'
import { getGetSpaceQueryKey, getListSpacesQueryKey } from '../src/api/generated/spaces.ts'
import { cacheCreatedSpace, creatableNamespaces, makeSpaceSlug, spaceErrorMessage, spacePath } from '../src/pages/SpacesPage/spaceApi.ts'
import { authReturnPath } from '../src/context/session.ts'

const created: CreateSpace201 = { id: 'space-id', namespaceId: 'namespace-id', createdByUserId: 'owner-id', name: 'My Project', slug: 'my-project', type: 'git', visibility: 'private', createdAt: '', updatedAt: '' }

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
    assert.deepEqual(client.getQueryData(key), [created])
    assert.equal(client.getQueryState(key)?.isInvalidated, true)
    assert.deepEqual(client.getQueryData(otherAccount), [])
    assert.deepEqual(client.getQueryData(otherUser), [])
    assert.deepEqual(client.getQueryData([...getGetSpaceQueryKey('owner', created.slug), 'owner-id']), created)
    assert.equal(client.getQueryData([...getGetSpaceQueryKey('owner', created.slug), null]), undefined)
  } finally { client.clear() }
})

test('creation does not invent a partial list when the list has not loaded', async () => {
  const client = new QueryClient()
  try {
    await cacheCreatedSpace(client, 'owner', 'owner-id', created)
    assert.equal(client.getQueryData([...getListSpacesQueryKey('owner'), 'owner-id']), undefined)
  } finally { client.clear() }
})

test('the Owner menu excludes organizations where the user is only a member', () => {
  const namespaces: ListNamespaces200Item[] = [
    { id: 'personal', ownerUserId: 'me', name: 'Me', slug: 'my-account', kind: 'personal', createdAt: '' },
    { id: 'owned-team', ownerUserId: 'me', name: 'My Team', slug: 'my-team', kind: 'organization', createdAt: '' },
    { id: 'other-team', ownerUserId: 'someone-else', name: 'Other Team', slug: 'other-team', kind: 'organization', createdAt: '' },
  ]
  assert.deepEqual(creatableNamespaces(namespaces, 'me').map(item => item.id), ['personal', 'owned-team'])
})

test('suggested slugs follow backend rules and routes encode their components', () => {
  assert.equal(makeSpaceSlug('  My New_Project!!  '), 'my-new-project')
  assert.equal(makeSpaceSlug('a'.repeat(39) + ' more'), 'a'.repeat(39))
  assert.equal(makeSpaceSlug('中文'), '')
  assert.equal(spacePath('my team', 'files#1'), '/my%20team/files%231')
  assert.match(spaceErrorMessage({ status: 409 }), /already used/)
  assert.match(spaceErrorMessage({ status: 403 }), /permission/)
})

test('login returns to internal Space URLs and rejects external URLs and auth loops', () => {
  assert.equal(authReturnPath('/owner/private-space'), '/owner/private-space')
  assert.equal(authReturnPath('/space/create?owner=team'), '/space/create?owner=team')
  for (const path of ['//example.com', 'https://example.com', '/\\example.com', '/login', '/register?from=/login', null]) assert.equal(authReturnPath(path), undefined)
})
