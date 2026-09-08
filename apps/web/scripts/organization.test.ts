import assert from 'node:assert/strict'
import { test } from 'node:test'
import { QueryClient } from '@tanstack/react-query'
import { memberErrorMessage, refreshOrganization } from '../src/pages/UserPage/organizationApi.ts'

test('organization membership changes invalidate member lists, Space access and organization icons', async () => {
  const client = new QueryClient()
  try {
    const base = '/api/namespaces/team'
    const changed = [[base], [base + '/members', 'owner'], [base + '/spaces', 'member'], [base + '/spaces/demo', 'member'], [base + '/spaces/demo/members', 'owner'], ['/api/namespaces', 'member']]
    const unchanged = [[base + '-other/members', 'owner'], ['/api/namespaces/another/spaces/demo', 'member']]
    for (const key of [...changed, ...unchanged]) client.setQueryData(key, [])
    await refreshOrganization(client, 'team')
    for (const key of changed) assert.equal(client.getQueryState(key)?.isInvalidated, true)
    for (const key of unchanged) assert.equal(client.getQueryState(key)?.isInvalidated, false)
  } finally { client.clear() }
})

test('member errors explain registration, organization membership and duplicate membership', () => {
  assert.match(memberErrorMessage({ status: 404 }, true, true), /registered user/)
  assert.match(memberErrorMessage({ status: 404 }, false, true), /organization first/)
  assert.match(memberErrorMessage({ status: 409 }, false, true), /already a member/)
  assert.match(memberErrorMessage({ status: 409 }, true), /owner cannot/)
  assert.match(memberErrorMessage({ status: 403 }, false), /Only an owner/)
})
