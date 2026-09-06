import assert from 'node:assert/strict'
import { test } from 'node:test'
import { authErrorMessage, loadSession } from '../src/context/session.ts'
import { login } from '../src/api/generated/auth.ts'
import { createUser } from '../src/api/generated/users.ts'

const user = { id: 'user-id', displayName: 'Test User', email: 'test@example.com', createdAt: '', updatedAt: '' }

test('session restoration uses the backend namespace instead of an email-derived slug', async (t) => {
  const requests: string[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, options?: RequestInit) => {
    requests.push(url)
    assert.equal(options?.credentials, 'include')
    return Response.json(url.endsWith('/auth/me') ? user : [
      { kind: 'organization', ownerUserId: user.id, slug: 'organization', name: 'Team' },
      { kind: 'personal', ownerUserId: 'someone-else', slug: 'other', name: 'Other' },
      { kind: 'personal', ownerUserId: user.id, slug: 'u-real-account', name: user.displayName },
    ])
  })
  const session = await loadSession()
  assert.equal(session?.namespace.account, 'u-real-account')
  assert.equal(session?.name, user.displayName)
  assert.deepEqual(requests, ['/api/auth/me', '/api/namespaces'])
})

test('an expired session is signed out, while unavailable services remain errors', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({}, { status: 401 }))
  assert.equal(await loadSession(), null)
  assert.equal(fetch.mock.callCount(), 1)
  fetch.mock.mockImplementation(async () => Response.json({}, { status: 500 }))
  await assert.rejects(loadSession(), { status: 500 })
  fetch.mock.mockImplementation(async () => { throw new TypeError('Network failure') })
  await assert.rejects(loadSession(), TypeError)
})

test('registration and login send typed credentials and preserve password whitespace', async (t) => {
  const password = ' password with spaces '
  const calls: { url: string; data: unknown }[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, options?: RequestInit) => {
    calls.push({ url, data: JSON.parse(options?.body as string) })
    assert.equal(options?.method, 'POST')
    assert.equal(options?.credentials, 'include')
    return Response.json(user, { status: url.endsWith('/users') ? 201 : 200 })
  })
  await createUser({ email: user.email, password, displayName: user.displayName })
  await login({ email: user.email, password })
  assert.deepEqual(calls, [
    { url: '/api/users', data: { email: user.email, password, displayName: user.displayName } },
    { url: '/api/auth/login', data: { email: user.email, password } },
  ])
})

test('auth failures show actionable messages without exposing server details', () => {
  assert.equal(authErrorMessage({ status: 401 }, 'login'), 'Incorrect email or password.')
  assert.match(authErrorMessage({ status: 409 }, 'register'), /already exists/)
  assert.match(authErrorMessage({ status: 503, info: { message: 'Internal connection details' } }, 'login'), /Unable to connect/)
  assert.match(authErrorMessage(new TypeError('Network failure'), 'logout'), /Unable to sign out/)
})
