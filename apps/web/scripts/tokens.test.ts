import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPersonalAccessToken, revokePersonalAccessToken } from '../src/api/generated/tokens.ts'
import { newTokenInput, tokenStatus } from '../src/pages/UserPage/tokenApi.ts'

test('read-only tokens request the minimum scope and write tokens also support private clones', () => {
  assert.deepEqual(newTokenInput(' Laptop ', false, 0), { name: 'Laptop', scopes: ['git:read'] })
  const now = Date.parse('2026-09-08T00:00:00Z')
  assert.deepEqual(newTokenInput('Laptop', true, 30, now), { name: 'Laptop', scopes: ['git:read', 'git:write'], expiresAt: '2026-10-08T00:00:00.000Z' })
})

test('revocation takes precedence over expiration and the expiry boundary is inclusive', () => {
  const token = { id: 'id', name: 'Laptop', scopes: [], createdAt: '2026-09-08T00:00:00Z', expiresAt: null, revokedAt: null, lastUsedAt: null }
  const now = Date.parse(token.createdAt)
  assert.equal(tokenStatus(token, now), 'Active')
  assert.equal(tokenStatus({ ...token, expiresAt: token.createdAt }, now), 'Expired')
  assert.equal(tokenStatus({ ...token, expiresAt: token.createdAt, revokedAt: token.createdAt }, now), 'Revoked')
})

test('generated token operations use JSON and session credentials and handle 204 revocation', async (t) => {
  const input = newTokenInput('Laptop', true, 0)
  const calls: string[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, options?: RequestInit) => {
    calls.push(url)
    assert.equal(options?.credentials, 'include')
    if (options?.method === 'POST') {
      assert.deepEqual(JSON.parse(options.body as string), input)
      return Response.json({ id: 'test-id', token: 'test-secret', ...input })
    }
    assert.equal(options?.method, 'DELETE')
    return new Response(null, { status: 204 })
  })
  const result = await createPersonalAccessToken(input)
  assert.equal(result.token, 'test-secret')
  assert.equal(await revokePersonalAccessToken(result.id), undefined)
  assert.deepEqual(calls, ['/api/auth/tokens', '/api/auth/tokens/test-id'])
})
