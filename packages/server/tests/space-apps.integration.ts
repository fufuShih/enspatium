import { expect, test, vi } from 'vitest'
import { createFixture } from './fixture.js'
import { migrateDatabase } from '../src/db/migrations.js'
import type { PublicUser } from '../src/db/types/user.types.js'
import type { PublicSpace } from '../src/db/types/space.types.js'
import type { PublicAuditEvent } from '../src/db/types/audit.types.js'
import type { toAppInstanceSummary } from '../src/services/app-instances.js'
import * as audit from '../src/services/audit/audit.js'

type AppSummary = ReturnType<typeof toAppInstanceSummary>
type AppList = { apps: AppSummary[]; canManage: boolean }

test('Space App management allows one replaceable App with owner-only mutations, shared content and audit history', async ({ onTestFinished }) => {
  const { app, session } = await createFixture({ after: cleanup => onTestFinished(cleanup), diagnostic: message => console.info(message) })
  const owner = session()
  const credentials = { email: 'space-app-owner@example.com', password: 'Apps-test-1234' }
  const user = await owner.request<PublicUser>('POST', '/users', 201, { ...credentials, displayName: 'Owner' })
  await owner.request('POST', '/auth/login', 200, credentials)
  const namespace = await app.db.selectFrom('namespaces').selectAll().where('owner_user_id', '=', user.id).executeTakeFirstOrThrow()
  const base = `/namespaces/${namespace.slug}/spaces`
  const space = await owner.request<PublicSpace>('POST', base, 201, { name: 'Shared content', slug: 'shared', type: 'object', app: 'note' })
  const url = `${base}/${space.slug}/apps`
  expect(await owner.request('GET', url)).toMatchObject({ canManage: true, apps: [{ id: space.id, appType: 'note', spaceId: space.id }] })
  await owner.request('POST', url, 409, { appType: 'note' })
  await owner.request('POST', url, 409, { appType: 'media', name: 'Photos' })
  const original = (await owner.request<AppList>('GET', url)).apps[0]!
  const renamed = await owner.request<AppSummary>('PATCH', `${url}/${space.id}`, 200, { name: 'Notebook' })
  expect(renamed).toMatchObject({ id: space.id, spaceId: space.id, appType: 'note', createdAt: original.createdAt, name: 'Notebook' })
  expect(new Date(renamed.updatedAt).getTime()).toBeGreaterThan(new Date(original.updatedAt).getTime())
  for (const input of [{ name: '' }, { name: ' ' }, {}, { appType: 'media' }, { pwa: { enabled: true } }, { config: { arbitrary: true } }]) {
    await owner.request('PATCH', `${url}/${space.id}`, 400, input)
  }
  const gitSpace = await owner.request<PublicSpace>('POST', base, 201, { name: 'Repository', slug: 'repo', type: 'git' })
  await owner.request('POST', `${base}/${gitSpace.slug}/apps`, 400, { appType: 'note' })
  const other = await owner.request<PublicSpace>('POST', base, 201, { name: 'Other', slug: 'other', type: 'object' })
  for (const input of [{ appType: 'note', name: ' ' }, { appType: 'note', name: 'x'.repeat(101) }, { appType: 'unknown' }, { name: 'No type' }]) {
    await owner.request('POST', `${base}/${other.slug}/apps`, 400, input)
  }
  await owner.request('PATCH', `${base}/${other.slug}/apps/${space.id}`, 404, { name: 'Wrong Space' })
  await owner.request('DELETE', `${base}/${other.slug}/apps/${space.id}`, 404)
  await owner.request('PATCH', `${url}/not-a-uuid`, 400, { name: 'Invalid' })
  const guest = session()
  await guest.request('GET', url, 401)
  await owner.request('PATCH', `${base}/${space.slug}`, 200, { visibility: 'public' })
  expect(await guest.request<AppList>('GET', url)).toMatchObject({ canManage: false, apps: expect.any(Array) })
  for (const [method, path, body] of [['POST', url, { appType: 'note' }], ['PATCH', `${url}/${space.id}`, { name: 'Denied' }], ['DELETE', `${url}/${space.id}`, undefined]] as const) {
    await guest.request(method, path, 401, body)
  }
  const reader = session()
  const member = await reader.request<PublicUser>('POST', '/users', 201, { email: 'space-app-member@example.com', password: credentials.password, displayName: 'Member' })
  await reader.request('POST', '/auth/login', 200, { email: member.email, password: credentials.password })
  await app.db.insertInto('namespace_members').values({ namespace_id: namespace.id, user_id: member.id, role: 'member' }).execute()
  await app.db.insertInto('space_members').values({ space_id: space.id, user_id: member.id, role: 'reader' }).execute()
  for (const role of ['reader', 'writer'] as const) {
    await app.db.updateTable('space_members').set({ role }).where('space_id', '=', space.id).where('user_id', '=', member.id).execute()
    expect((await reader.request<AppList>('GET', url)).canManage).toBe(false)
    await reader.request('POST', url, 403, { appType: 'note' })
    await reader.request('PATCH', `${url}/${space.id}`, 403, { name: 'Denied' })
    await reader.request('DELETE', `${url}/${space.id}`, 403)
  }
  await owner.request('PATCH', `${base}/${space.slug}`, 200, { visibility: 'private' })
  await app.db.updateTable('space_members').set({ role: 'writer' }).where('space_id', '=', space.id).where('user_id', '=', user.id).execute()
  await app.db.updateTable('space_members').set({ role: 'owner' }).where('space_id', '=', space.id).where('user_id', '=', member.id).execute()
  expect((await reader.request<AppList>('GET', url)).canManage).toBe(true)
  await reader.request('POST', url, 409, { appType: 'ebook' })
  await app.db.insertInto('app_types').values({ type: 'owner-view', name: 'Owner view', kind: 'custom', owner_user_id: user.id, storage_type: 'object' }).execute()
  await reader.request('POST', `${base}/${other.slug}/apps`, 403, { appType: 'owner-view' })
  const custom = await owner.request<AppSummary>('POST', `${base}/${other.slug}/apps`, 201, { appType: 'owner-view' })
  await owner.request('POST', `${base}/${other.slug}/apps`, 409, { appType: 'note' })
  await owner.request('DELETE', `${base}/${other.slug}/apps/${custom.id}`, 204)
  await app.db.updateTable('users').set({ is_disabled: true }).where('id', '=', member.id).execute()
  await reader.request('POST', url, 401, { appType: 'note' })
  await reader.request('GET', url, 401)
  await app.db.deleteFrom('space_members').where('space_id', '=', space.id).where('user_id', '=', member.id).execute()
  expect((await owner.request<AppList>('GET', url)).canManage).toBe(true) // Namespace owner still manages it.

  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: credentials })
  const cookies = login.headers['set-cookie']
  const cookie = (Array.isArray(cookies) ? cookies : [String(cookies)]).map(value => value.split(';')[0]).join('; ')
  const uploaded = await app.inject({ method: 'PUT', url: `${base}/${space.slug}/objects/note.md`, headers: { cookie, 'content-type': 'text/markdown' }, payload: '# Keep this content' })
  expect(uploaded.statusCode).toBe(201)
  const versions = await app.db.selectFrom('space_object_versions').selectAll().where('space_id', '=', space.id).execute()
  const before = await app.db.selectFrom('spaces').selectAll().where('id', '=', space.id).executeTakeFirstOrThrow()
  const members = await app.db.selectFrom('space_members').selectAll().where('space_id', '=', space.id).execute()
  const response = await app.inject({ url, headers: { cookie } })
  expect(response.headers['cache-control']).toBe('private, no-store')
  await owner.request('DELETE', `${url}/${space.id}`, 204)
  await owner.request('GET', `/apps/note/spaces/${space.id}`, 404)
  const media = await owner.request<AppSummary>('POST', url, 201, { appType: 'media', name: '  Photos  ' })
  expect(media).toMatchObject({ name: 'Photos', spaceId: space.id, appType: 'media', config: {}, pwa: { enabled: false } })
  await owner.request('POST', url, 409, { appType: 'ebook' })
  expect((await owner.request<AppList>('GET', url)).apps.map(instance => instance.id)).toEqual([media.id])
  expect(await app.db.selectFrom('spaces').selectAll().where('id', '=', space.id).executeTakeFirstOrThrow()).toEqual({ ...before, app_type: null })
  expect(await app.db.selectFrom('space_members').selectAll().where('space_id', '=', space.id).execute()).toEqual(members)
  expect(await app.db.selectFrom('space_object_versions').selectAll().where('space_id', '=', space.id).execute()).toEqual(versions)
  expect((await app.inject({ url: `${base}/${space.slug}/objects/note.md`, headers: { cookie } })).body).toBe('# Keep this content')
  const events = await owner.request<PublicAuditEvent[]>('GET', `${base}/${space.slug}/audit-events`)
  expect(events.filter(event => event.metadata.appId === space.id).map(event => event.action).sort()).toEqual(['app.deleted', 'app.updated'])
  expect(events.find(event => event.action === 'app.created' && event.metadata.appId === media.id)).toMatchObject({ actorUserId: user.id, spaceId: space.id, metadata: { appType: 'media' } })
})

test('App mutations roll back when their audit event cannot be saved', async ({ onTestFinished }) => {
  const { app, session } = await createFixture({ after: cleanup => onTestFinished(cleanup), diagnostic: message => console.info(message) })
  const owner = session()
  const credentials = { email: 'app-audit@example.com', password: 'Apps-test-1234' }
  const user = await owner.request<PublicUser>('POST', '/users', 201, { ...credentials, displayName: 'Owner' })
  await owner.request('POST', '/auth/login', 200, credentials)
  const namespace = await app.db.selectFrom('namespaces').selectAll().where('owner_user_id', '=', user.id).executeTakeFirstOrThrow()
  const base = `/namespaces/${namespace.slug}/spaces`
  const space = await owner.request<PublicSpace>('POST', base, 201, { name: 'Original', slug: 'original', type: 'object', app: 'note' })
  const url = `${base}/${space.slug}/apps`
  const empty = await owner.request<PublicSpace>('POST', base, 201, { name: 'Empty', slug: 'empty', type: 'object' })
  const emptyUrl = `${base}/${empty.slug}/apps`
  const before = await owner.request('GET', url)
  const events = await app.db.selectFrom('audit_events').selectAll().where('space_id', '=', space.id).execute()
  const failure = vi.spyOn(audit, 'createAuditEvent').mockRejectedValue(new Error('Test audit failure'))
  try {
    await owner.request('POST', emptyUrl, 500, { appType: 'note' })
    await owner.request('PATCH', `${url}/${space.id}`, 500, { name: 'Changed' })
    await owner.request('DELETE', `${url}/${space.id}`, 500)
  } finally { failure.mockRestore() }
  expect(await owner.request('GET', url)).toEqual(before)
  expect((await owner.request<AppList>('GET', emptyUrl)).apps).toEqual([])
  expect(await app.db.selectFrom('audit_events').selectAll().where('space_id', '=', space.id).execute()).toEqual(events)
  expect(await owner.request('GET', `/apps/note/spaces/${space.id}`)).toMatchObject({ id: space.id })
})

test('single-App migration preserves legacy instances but refuses any additional instance', async ({ onTestFinished }) => {
  const { app, schema, session } = await createFixture({
    after: cleanup => onTestFinished(cleanup), diagnostic: message => console.info(message), migrationTarget: '0022_add_pwa_icons',
  })
  const owner = session()
  const credentials = { email: 'single-app-migration@example.com', password: 'Apps-test-1234' }
  const user = await owner.request<PublicUser>('POST', '/users', 201, { ...credentials, displayName: 'Owner' })
  await owner.request('POST', '/auth/login', 200, credentials)
  const namespace = await app.db.selectFrom('namespaces').selectAll().where('owner_user_id', '=', user.id).executeTakeFirstOrThrow()
  const space = await owner.request<PublicSpace>('POST', `/namespaces/${namespace.slug}/spaces`, 201,
    { name: 'Legacy views', slug: 'legacy-views', type: 'object', app: 'note' })
  const extra = await app.db.insertInto('space_apps').values({
    space_id: space.id, storage_type: 'object', app_type: 'media', name: 'Legacy extra',
  }).returningAll().executeTakeFirstOrThrow()

  expect((await migrateDatabase(app.db, schema)).error).toBeUndefined()
  expect(await app.db.selectFrom('space_apps').select('id').where('space_id', '=', space.id).execute()).toHaveLength(2)
  await expect(app.db.insertInto('space_apps').values({
    space_id: space.id, storage_type: 'object', app_type: 'ebook', name: 'Rejected',
  }).execute()).rejects.toMatchObject({ code: '23505', constraint: 'space_apps_space_id_unique' })
  await expect(app.db.updateTable('space_apps').set({ name: 'Legacy renamed' }).where('id', '=', extra.id).execute()).resolves.toBeDefined()
})

test('the apps resource reservation refuses a conflicting registry entry without changing existing data', async ({ onTestFinished }) => {
  const { app, schema } = await createFixture({ after: cleanup => onTestFinished(cleanup), diagnostic: message => console.info(message), migrationTarget: '0020_create_space_apps' })
  const entry = { type: 'apps', name: 'Existing registration', kind: 'builtin' as const, owner_user_id: null, storage_type: 'object' as const }
  await app.db.insertInto('app_types').values(entry).execute()
  expect((await migrateDatabase(app.db, schema)).error).toMatchObject({ code: '23514' })
  expect(await app.db.selectFrom('app_types').selectAll().where('type', '=', 'apps').executeTakeFirstOrThrow()).toMatchObject(entry)
  await expect(app.db.insertInto('app_types').values({ ...entry, type: 'objects' }).execute()).rejects.toMatchObject({ constraint: 'app_types_reserved_routes' })
  await app.db.deleteFrom('app_types').where('type', '=', 'apps').execute()
  expect((await migrateDatabase(app.db, schema)).error).toBeUndefined()
  expect((await migrateDatabase(app.db, schema)).results).toEqual([])
  await expect(app.db.insertInto('app_types').values(entry).execute()).rejects.toMatchObject({ constraint: 'app_types_reserved_routes' })
})
