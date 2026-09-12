import { expect, test } from 'vitest'
import { createFixture } from './fixture.js'
import { createUser } from '../src/services/users.js'
import { createPersonalAccessToken } from '../src/services/tokens.js'

test('closed registration, admin provisioning, account suspension and persistent session/token revocation', async t => {
  const fixture = await createFixture({ after: fn => t.onTestFinished(fn), diagnostic: () => {} })
  const { app, session, origin } = fixture
  app.config.REGISTRATION_ENABLED = false
  const adminInput = { displayName: 'Site admin', email: 'admin@example.test', password: 'admin-password' }
  const admin = await createUser(app.db, adminInput, { bootstrapAdmin: true })
  await expect(createUser(app.db, { ...adminInput, email: 'another@example.test' }, { bootstrapAdmin: true })).rejects.toThrow('administrator already exists')
  expect(await app.db.selectFrom('users').select('id').where('email', '=', 'another@example.test').executeTakeFirst()).toBeUndefined()
  const owner = session()
  await owner.request('POST', '/auth/login', 200, adminInput)
  expect(await owner.request('GET', '/auth/settings')).toEqual({ registrationEnabled: false })
  const input = { displayName: 'Invited user', email: 'invite@example.test', password: 'invited-password' }
  await session().request('POST', '/users', 403, input)
  await session().request('GET', '/admin/users', 401)
  const user = await owner.request<{ id: string; isAdmin: boolean; isDisabled: boolean }>('POST', '/admin/users', 201, input)
  expect(user).toMatchObject({ isAdmin: false, isDisabled: false })
  const member = session()
  const untouched = session()
  const staleLogin = session()
  for (const client of [member, untouched, staleLogin]) await client.request('POST', '/auth/login', 200, input)
  await member.request('GET', '/admin/users', 403)
  await member.request('PATCH', `/admin/users/${admin.id}`, 403, { disabled: true })
  await owner.request('PATCH', `/admin/users/${admin.id}`, 409, { disabled: true })
  const users = await owner.request<{ users: { id: string }[] }>('GET', '/admin/users?search=invite')
  expect(users.users.map(value => value.id)).toEqual([user.id])
  await app.db.insertInto('users').values(Array.from({ length: 31 }, (_, i) => ({ email: `page-${i}@example.test`, display_name: 'Page fixture', password_hash: 'unused-in-this-test' }))).execute()
  const firstPage = await owner.request<{ users: { id: string }[]; nextCursor: string }>('GET', '/admin/users?search=page-')
  const lastPage = await owner.request<{ users: { id: string }[]; nextCursor: null }>('GET', '/admin/users?search=page-&cursor=' + firstPage.nextCursor)
  expect(firstPage.users).toHaveLength(30)
  expect(lastPage.users).toHaveLength(1)
  expect(new Set([...firstPage.users, ...lastPage.users].map(row => row.id)).size).toBe(31)
  expect(lastPage.nextCursor).toBeNull()
  const namespaces = await member.request<{ slug: string }[]>('GET', '/namespaces')
  const account = namespaces[0]!.slug
  const base = `/namespaces/${account}/spaces`
  await member.request('POST', base, 201, { name: 'Private', slug: 'private', type: 'git' })
  const token = await member.request<{ token: string; id: string }>('POST', '/auth/tokens', 201, { name: 'Before suspension', scopes: ['git:read', 'git:write'] })
  const gitUrl = `${origin}/git/${account}/private.git/info/refs?service=git-upload-pack`
  const gitRequest = () => fetch(gitUrl, { headers: { authorization: 'Basic ' + Buffer.from('git:' + token.token).toString('base64') } })
  expect((await gitRequest()).status).toBe(200)
  await owner.request('PATCH', `/admin/users/${user.id}`, 200, { disabled: true })
  await owner.request('PATCH', `/admin/users/${user.id}`, 200, { disabled: true }) // Safe no-op retry.
  await member.request('GET', base, 401)
  await session().request('POST', '/auth/login', 401, input)
  expect((await gitRequest()).status).toBe(401)
  expect((await app.db.selectFrom('users').select('session_version').where('id', '=', user.id).executeTakeFirstOrThrow()).session_version).toBe(1)
  await owner.request('PATCH', `/admin/users/${user.id}`, 200, { disabled: false })
  await expect(createPersonalAccessToken(app.db, user.id, { name: 'Previously admitted request', scopes: ['git:read'] }, 0)).rejects.toMatchObject({ statusCode: 401 })
  await untouched.request('GET', '/auth/me', 401) // Cookie never presented during suspension must also stay invalid.
  await staleLogin.request('POST', '/auth/login', 200, input)
  await staleLogin.request('GET', '/auth/me', 200) // Fresh authentication replaces a revoked cookie in one request.
  expect((await gitRequest()).status).toBe(401)
  await member.request('POST', '/auth/login', 200, input)
  expect((await member.request<unknown[]>('GET', base)).length).toBe(1)
  const revoked = await app.db.selectFrom('personal_access_tokens').select('revoked_at').where('id', '=', token.id).executeTakeFirstOrThrow()
  expect(revoked.revoked_at).not.toBeNull()
  const events = await app.db.selectFrom('audit_events').select(['action', 'metadata']).where('action', 'in', ['user.disabled', 'user.enabled']).execute()
  expect(events.map(event => event.action).sort()).toEqual(['user.disabled', 'user.enabled'])
  expect(events.every(event => Object.keys(event.metadata).length === 1)).toBe(true)
  await app.db.updateTable('users').set({ is_admin: false }).where('id', '=', admin.id).execute()
  await owner.request('GET', '/admin/users', 403)
  await owner.request('PATCH', `/admin/users/${user.id}`, 403, { disabled: true })
})

test('authentication limits run before expensive work, aggregate Git routes, and ignore spoofed proxy headers by default', async t => {
  const { app } = await createFixture({ after: fn => t.onTestFinished(fn), diagnostic: () => {} })
  app.config.LOGIN_RATE_LIMIT = 2
  app.config.LOGIN_ACCOUNT_RATE_LIMIT = 100
  app.config.REGISTRATION_RATE_LIMIT = 1
  app.config.GIT_AUTH_RATE_LIMIT = 2
  for (let i = 0; i < 3; i++) {
    const response = await app.inject({ method: 'POST', url: '/auth/login', remoteAddress: '192.0.2.1', headers: { 'x-forwarded-for': `198.51.100.${i}` }, payload: { email: 'missing@example.test', password: 'wrong' } })
    expect(response.statusCode).toBe(i < 2 ? 401 : 429)
    if (i === 2) expect(Number(response.headers['retry-after'])).toBeGreaterThan(0)
  }
  app.config.LOGIN_ACCOUNT_RATE_LIMIT = 2
  for (let i = 0; i < 3; i++) {
    const response = await app.inject({ method: 'POST', url: '/auth/login', remoteAddress: `192.0.2.${i + 10}`, payload: { email: i === 1 ? ' ACCOUNT@example.test ' : 'account@example.test', password: 'wrong' } })
    expect(response.statusCode).toBe(i < 2 ? 401 : 429)
  }
  for (let i = 0; i < 2; i++) {
    const response = await app.inject({ method: 'POST', url: '/users', remoteAddress: '192.0.2.30', payload: { displayName: 'Rate user', email: `rate${i}@example.test`, password: 'test-password' } })
    expect(response.statusCode).toBe(i === 0 ? 201 : 429)
  }
  for (const [i, path] of ['info/refs?service=git-upload-pack', 'info/refs?service=git-receive-pack', 'git-receive-pack'].entries()) {
    const response = await app.inject({ method: i === 2 ? 'POST' : 'GET', url: `/git/unknown/unknown.git/${path}`, remoteAddress: '192.0.2.40' })
    expect(response.statusCode).toBe(i < 2 ? i === 0 ? 404 : 401 : 429)
  }
  expect((await app.inject('/health')).statusCode).toBe(200)
})
