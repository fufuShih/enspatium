import secureSession from '@fastify/secure-session'
import Fastify from 'fastify'
import type { Kysely } from 'kysely'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Database } from '../db/index.js'
import { authenticateUser, createUser, getUser, getSessionUser, UserServiceError } from '../services/users.js'
import { authRoutes } from './auth.route.js'
import { userRoutes } from './users.route.js'

// Exercise real HTTP validation and encrypted cookies; database access is stubbed.
vi.mock('../services/users.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/users.js')>(),
  authenticateUser: vi.fn(),
  createUser: vi.fn(),
  getUser: vi.fn(),
  getSessionUser: vi.fn(),
}))

const user = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Test User',
  email: 'test@example.com',
  createdAt: '2026-09-06T00:00:00.000Z',
  updatedAt: '2026-09-06T00:00:00.000Z',
}
const sessionUser = { ...user, isAdmin: false }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(authenticateUser).mockResolvedValue({ ...sessionUser, sessionVersion: 0 })
  vi.mocked(createUser).mockResolvedValue(user)
  vi.mocked(getUser).mockResolvedValue(user)
  vi.mocked(getSessionUser).mockResolvedValue(sessionUser)
})

async function createApp() {
  const app = Fastify()
  app.decorate('db', {} as Kysely<Database>)
  await app.register(secureSession, {
    key: Buffer.alloc(32, 1),
    cookieName: 'enspatium_session',
    cookie: { path: '/', httpOnly: true, sameSite: 'strict', secure: false },
  })
  await app.register(userRoutes)
  await app.register(authRoutes)
  return app
}

it('establishes a session, restores the user from its cookie, and clears it on logout', async () => {
  const app = await createApp()
  try {
    expect((await app.inject('/auth/me')).statusCode).toBe(401)
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: user.email, password: 'test-password' } })
    expect(login.statusCode).toBe(200)
    expect(login.json()).toEqual(sessionUser)
    expect(login.headers['set-cookie']).toContain('HttpOnly')
    const cookie = login.cookies.find(cookie => cookie.name === 'enspatium_session')!
    const me = await app.inject({ url: '/auth/me', cookies: { [cookie.name]: cookie.value } })
    expect(me.statusCode).toBe(200)
    expect(me.json()).toEqual(sessionUser)
    expect(getSessionUser).toHaveBeenCalledWith(app.db, user.id)
    expect(me.headers['cache-control']).toBe('private, no-store')
    const logout = await app.inject({ method: 'POST', url: '/auth/logout', cookies: { [cookie.name]: cookie.value } })
    expect(logout.statusCode).toBe(204)
    expect(logout.body).toBe('')
    expect(logout.cookies.find(cookie => cookie.name === 'enspatium_session')?.value).toBe('')
    expect((await app.inject('/auth/me')).statusCode).toBe(401)
  } finally {
    await app.close()
  }
})

it('rejects invalid credentials without issuing a session cookie', async () => {
  vi.mocked(authenticateUser).mockRejectedValue(new UserServiceError('INVALID_CREDENTIALS', 401, 'invalid email or password'))
  const app = await createApp()
  try {
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: user.email, password: 'wrong-password' } })
    expect(response.statusCode).toBe(401)
    expect(response.headers['set-cookie']).toBeUndefined()
  } finally {
    await app.close()
  }
})

it('validates registration and reports duplicate accounts', async () => {
  const app = await createApp()
  const payload = { displayName: user.displayName, email: user.email, password: 'test-password' }
  try {
    const invalid = await app.inject({ method: 'POST', url: '/users', payload: { ...payload, password: 'short' } })
    expect(invalid.statusCode).toBe(400)
    expect(createUser).not.toHaveBeenCalled()
    const created = await app.inject({ method: 'POST', url: '/users', payload })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toEqual(user)
    expect(created.headers['set-cookie']).toBeUndefined()
    vi.mocked(createUser).mockRejectedValue(new UserServiceError('CONFLICT', 409, 'email already exists'))
    expect((await app.inject({ method: 'POST', url: '/users', payload })).statusCode).toBe(409)
  } finally {
    await app.close()
  }
})
