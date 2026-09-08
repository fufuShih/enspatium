import assert from 'node:assert/strict'
import { test } from 'node:test'
import { QueryClient } from '@tanstack/react-query'
import { refreshSpaceSettings } from '../src/pages/SpacesPage/settingsApi.ts'

test('settings changes invalidate metadata, contents and account list without invalidating other Spaces', async () => {
  const client = new QueryClient()
  try {
    const base = '/api/namespaces/owner/spaces/demo'
    const affected = [[base, 'owner'], [base, null], [base + '/git', 'owner'], [base + '/git/tree?ref=main', 'owner'], ['/api/namespaces/owner/spaces', 'owner']]
    const unaffected = [[base + '-other', 'owner'], ['/api/namespaces/another/spaces/demo', 'owner']]
    for (const key of [...affected, ...unaffected]) client.setQueryData(key, {})
    await refreshSpaceSettings(client, 'owner', 'demo')
    for (const key of affected) assert.equal(client.getQueryState(key)?.isInvalidated, true)
    for (const key of unaffected) assert.equal(client.getQueryState(key)?.isInvalidated, false)
  } finally { client.clear() }
})
