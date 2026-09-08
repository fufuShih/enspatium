import { expect, test } from 'vitest'
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
    for (const key of changed) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    for (const key of unchanged) expect(client.getQueryState(key)?.isInvalidated).toBe(false)
  } finally { client.clear() }
})

test('member errors explain registration, organization membership and duplicate membership', () => {
  expect(memberErrorMessage({ status: 404 }, true, true)).toMatch(/registered user/)
  expect(memberErrorMessage({ status: 404 }, false, true)).toMatch(/organization first/)
  expect(memberErrorMessage({ status: 409 }, false, true)).toMatch(/already a member/)
  expect(memberErrorMessage({ status: 409 }, true)).toMatch(/owner cannot/)
  expect(memberErrorMessage({ status: 403 }, false)).toMatch(/Only an owner/)
})
