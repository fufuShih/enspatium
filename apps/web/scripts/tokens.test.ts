import { expect, test, vi } from 'vitest'
import { createPersonalAccessToken, revokePersonalAccessToken } from '../src/api/generated/tokens.ts'
import { newTokenInput, tokenStatus } from '../src/pages/UserPage/tokenApi.ts'

test('read-only tokens request the minimum scope and write tokens also support private clones', () => {
  expect(newTokenInput(' Laptop ', false, 0)).toStrictEqual({ name: 'Laptop', scopes: ['git:read'] })
  const now = Date.parse('2026-09-08T00:00:00Z')
  expect(newTokenInput('Laptop', true, 30, now)).toStrictEqual({ name: 'Laptop', scopes: ['git:read', 'git:write'], expiresAt: '2026-10-08T00:00:00.000Z' })
})

test('revocation takes precedence over expiration and the expiry boundary is inclusive', () => {
  const token = { id: 'id', name: 'Laptop', scopes: [], createdAt: '2026-09-08T00:00:00Z', expiresAt: null, revokedAt: null, lastUsedAt: null }
  const now = Date.parse(token.createdAt)
  expect(tokenStatus(token, now)).toBe('Active')
  expect(tokenStatus({ ...token, expiresAt: token.createdAt }, now)).toBe('Expired')
  expect(tokenStatus({ ...token, expiresAt: token.createdAt, revokedAt: token.createdAt }, now)).toBe('Revoked')
})

test('generated token operations use JSON and session credentials and handle 204 revocation', async () => {
  const input = newTokenInput('Laptop', true, 0)
  const calls: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    calls.push(String(url))
    expect(options?.credentials).toBe('include')
    if (options?.method === 'POST') {
      expect(JSON.parse(options.body as string)).toStrictEqual(input)
      return Response.json({ id: 'test-id', token: 'test-secret', ...input })
    }
    expect(options?.method).toBe('DELETE')
    return new Response(null, { status: 204 })
  })
  const result = await createPersonalAccessToken(input)
  expect(result.token).toBe('test-secret')
  expect(await revokePersonalAccessToken(result.id)).toBe(undefined)
  expect(calls).toStrictEqual(['/api/auth/tokens', '/api/auth/tokens/test-id'])
})
