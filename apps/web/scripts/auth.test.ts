import { expect, test, vi } from 'vitest'
import { authErrorMessage, loadSession } from '../src/context/session.ts'
import { login } from '../src/api/generated/auth.ts'
import { createUser } from '../src/api/generated/users.ts'

const user = { id: 'user-id', displayName: 'Test User', email: 'test@example.com', isAdmin: true, createdAt: '', updatedAt: '' }

test('session restoration uses the backend namespace instead of an email-derived slug', async () => {
  const requests: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    requests.push(String(url))
    expect(options?.credentials).toBe('include')
    return Response.json(String(url).endsWith('/auth/me') ? user : [
      { kind: 'organization', ownerUserId: user.id, slug: 'organization', name: 'Team' },
      { kind: 'personal', ownerUserId: 'someone-else', slug: 'other', name: 'Other' },
      { kind: 'personal', ownerUserId: user.id, slug: 'u-real-account', name: user.displayName },
    ])
  })
  const session = await loadSession()
  expect(session?.namespace.account).toBe('u-real-account')
  expect(session?.name).toBe(user.displayName)
  expect(session?.isAdmin).toBe(true)
  expect(requests).toStrictEqual(['/api/auth/me', '/api/namespaces'])
})

test('an expired session is signed out, while unavailable services remain errors', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({}, { status: 401 }))
  expect(await loadSession()).toBe(null)
  expect(fetch).toHaveBeenCalledTimes(1)
  fetch.mockImplementation(async () => Response.json({}, { status: 500 }))
  await expect(loadSession()).rejects.toMatchObject({ status: 500 })
  fetch.mockImplementation(async () => { throw new TypeError('Network failure') })
  await expect(loadSession()).rejects.toThrow(TypeError)
})

test('registration and login send typed credentials and preserve password whitespace', async () => {
  const password = ' password with spaces '
  const calls: { url: string; data: unknown }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    calls.push({ url: String(url), data: JSON.parse(options?.body as string) })
    expect(options?.method).toBe('POST')
    expect(options?.credentials).toBe('include')
    return Response.json(user, { status: String(url).endsWith('/users') ? 201 : 200 })
  })
  await createUser({ email: user.email, password, displayName: user.displayName })
  await login({ email: user.email, password })
  expect(calls).toStrictEqual([
    { url: '/api/users', data: { email: user.email, password, displayName: user.displayName } },
    { url: '/api/auth/login', data: { email: user.email, password } },
  ])
})

test('auth failures show actionable messages without exposing server details', () => {
  expect(authErrorMessage({ status: 401 }, 'login')).toBe('Incorrect email or password.')
  expect(authErrorMessage({ status: 409 }, 'register')).toMatch(/already exists/)
  expect(authErrorMessage({ status: 503, info: { message: 'Internal connection details' } }, 'login')).toMatch(/Unable to connect/)
  expect(authErrorMessage(new TypeError('Network failure'), 'logout')).toMatch(/Unable to sign out/)
})
