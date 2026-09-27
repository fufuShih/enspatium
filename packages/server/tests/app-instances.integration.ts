import { randomUUID } from 'node:crypto'
import { expect, test, vi } from 'vitest'
import { sql } from 'kysely'
import { createFixture } from './fixture.js'
import { migrateDatabase } from '../src/db/migrations.js'
import type { PublicUser } from '../src/db/types/user.types.js'
import type { PublicSpace } from '../src/db/types/space.types.js'
import { createAppInstance, deleteAppInstance, getAppInstance, listAppInstances, updateAppInstance } from '../src/services/app-instances.js'
import * as storage from '../src/services/space/storage.js'

const pwaDefaults = { enabled: false, iconObjectId: null, themeColor: null, offlinePolicy: 'shell' }

test('migration preserves legacy UUIDs, timestamps, Space settings and membership', async ({ onTestFinished }) => {
  const { app, schema, session } = await createFixture({
    after: cleanup => onTestFinished(cleanup), diagnostic: message => console.info(message),
    migrationTarget: '0019_create_jobs',
  })
  const owner = session()
  const user = await owner.request<PublicUser>('POST', '/users', 201, {
    email: 'migration@example.com', password: 'Apps-test-1234', displayName: 'Owner',
  })
  const namespace = await app.db.selectFrom('namespaces').selectAll().where('owner_user_id', '=', user.id).executeTakeFirstOrThrow()
  await app.db.insertInto('app_types').values({ type: 'custom-view', name: 'Custom', kind: 'custom', owner_user_id: user.id, storage_type: 'object' }).execute()
  const spaces = await app.db.insertInto('spaces').values(['media', 'ebook', 'note', 'custom-view', null].map((appType, index) => ({
    namespace_id: namespace.id, created_by_user_id: user.id, name: `Existing ${index}`, slug: `existing-${index}`,
    type: 'object' as const, app_type: appType, visibility: 'private' as const, quota_bytes: '123456',
    created_at: new Date('2026-01-01T00:00:00Z'), updated_at: new Date('2026-01-02T00:00:00Z'),
  }))).returningAll().execute()
  await app.db.insertInto('space_members').values(spaces.map(space => ({ space_id: space.id, user_id: user.id, role: 'owner' as const }))).execute()
  const memberships = await app.db.selectFrom('space_members').selectAll().orderBy('space_id').execute()
  const migrated = await migrateDatabase(app.db, schema)
  expect(migrated.error).toBeUndefined()
  expect((await migrateDatabase(app.db, schema)).results).toEqual([])
  const instances = await app.db.selectFrom('space_apps').selectAll().execute()
  expect(instances).toHaveLength(4)
  for (const space of spaces.filter(space => space.app_type !== null)) {
    expect(instances.find(instance => instance.id === space.id)).toEqual({
      id: space.id, space_id: space.id, app_type: space.app_type, storage_type: space.type, name: space.name,
      config: {}, pwa: pwaDefaults, pwa_icon_192: null, pwa_icon_512: null, created_at: space.created_at, updated_at: space.updated_at,
    })
  }
  expect(await app.db.selectFrom('spaces').selectAll().execute()).toEqual(expect.arrayContaining(spaces))
  expect(await app.db.selectFrom('space_members').selectAll().orderBy('space_id').execute()).toEqual(memberships)
})

test('a single App shares Space content and permissions; deleting it does not delete content', async ({ onTestFinished }) => {
  const { app, session } = await createFixture({
    after: cleanup => onTestFinished(cleanup), diagnostic: message => console.info(message),
  })
  const owner = session()
  const credentials = { email: 'instances@example.com', password: 'Apps-test-1234' }
  const user = await owner.request<PublicUser>('POST', '/users', 201, { ...credentials, displayName: 'Owner' })
  await owner.request('POST', '/auth/login', 200, credentials)
  const namespace = await app.db.selectFrom('namespaces').selectAll().where('owner_user_id', '=', user.id).executeTakeFirstOrThrow()
  const base = `/namespaces/${namespace.slug}/spaces`
  const space = await owner.request<PublicSpace>('POST', base, 201, { name: 'Shared content', slug: 'shared-content', type: 'object' })
  const args = [app.db, user.id, namespace.slug, space.slug] as const
  const second = await createAppInstance(...args, { appType: 'note' })
  expect(second).toMatchObject({ name: space.name, space_id: space.id, app_type: 'note', config: {}, pwa: pwaDefaults })
  await expect(createAppInstance(...args, { appType: 'media', name: 'Media view' })).rejects.toMatchObject({ statusCode: 409 })
  expect(await listAppInstances(...args)).toHaveLength(1)
  expect(await getAppInstance(app.db, user.id, 'note', second.id)).toMatchObject({ space_id: space.id })
  await expect(getAppInstance(app.db, user.id, 'media', second.id)).rejects.toMatchObject({ statusCode: 404 })
  await expect(getAppInstance(app.db, undefined, 'note', second.id)).rejects.toMatchObject({ statusCode: 401 })
  await expect(listAppInstances(app.db, undefined, namespace.slug, space.slug)).rejects.toMatchObject({ statusCode: 401 })
  const renamed = await updateAppInstance(...args, second.id, { name: 'Second notebook', config: {} })
  expect(renamed.name).toBe('Second notebook')
  expect(renamed.updated_at.getTime()).toBeGreaterThan(second.updated_at.getTime())
  await expect(updateAppInstance(...args, second.id, { config: { arbitrary: true } })).rejects.toMatchObject({ statusCode: 400 })

  const member = await session().request<PublicUser>('POST', '/users', 201, {
    email: 'member@example.com', password: credentials.password, displayName: 'Member',
  })
  await expect(getAppInstance(app.db, member.id, 'note', second.id)).rejects.toMatchObject({ statusCode: 403 })
  await app.db.insertInto('namespace_members').values({ namespace_id: namespace.id, user_id: member.id, role: 'member' }).execute()
  await app.db.insertInto('space_members').values({ space_id: space.id, user_id: member.id, role: 'reader' }).execute()
  const memberArgs = [app.db, member.id, namespace.slug, space.slug] as const
  for (const role of ['reader', 'writer'] as const) {
    await app.db.updateTable('space_members').set({ role }).where('space_id', '=', space.id).where('user_id', '=', member.id).execute()
    expect(await listAppInstances(...memberArgs)).toHaveLength(1)
    await expect(createAppInstance(...memberArgs, { appType: 'note' })).rejects.toMatchObject({ statusCode: 403 })
    await expect(updateAppInstance(...memberArgs, second.id, { name: 'Denied' })).rejects.toMatchObject({ statusCode: 403 })
    await expect(deleteAppInstance(...memberArgs, second.id)).rejects.toMatchObject({ statusCode: 403 })
  }
  await app.db.updateTable('space_members').set({ role: 'writer' }).where('space_id', '=', space.id).where('user_id', '=', user.id).execute()
  await app.db.updateTable('space_members').set({ role: 'owner' }).where('space_id', '=', space.id).where('user_id', '=', member.id).execute()
  await expect(createAppInstance(...memberArgs, { appType: 'ebook' })).rejects.toMatchObject({ statusCode: 409 })
  await app.db.deleteFrom('space_members').where('space_id', '=', space.id).where('user_id', '=', member.id).execute()
  await expect(getAppInstance(app.db, member.id, 'note', second.id)).rejects.toMatchObject({ statusCode: 403 })
  await owner.request('PATCH', `${base}/${space.slug}`, 200, { visibility: 'public' })
  expect(await getAppInstance(app.db, undefined, 'note', second.id)).toMatchObject({ id: second.id })
  await owner.request('PATCH', `${base}/${space.slug}`, 200, { visibility: 'private' })
  await expect(getAppInstance(app.db, undefined, 'note', second.id)).rejects.toMatchObject({ statusCode: 401 })

  const otherSpace = await owner.request<PublicSpace>('POST', base, 201, { name: 'Other', slug: 'other-space', type: 'object' })
  await expect(updateAppInstance(app.db, user.id, namespace.slug, otherSpace.slug, second.id, { name: 'Wrong Space' })).rejects.toMatchObject({ statusCode: 404 })
  await expect(deleteAppInstance(app.db, user.id, namespace.slug, otherSpace.slug, second.id)).rejects.toMatchObject({ statusCode: 404 })
  const standalone = await createAppInstance(app.db, user.id, namespace.slug, otherSpace.slug, { appType: 'note' })
  await owner.request('GET', `/apps/note/spaces/${otherSpace.id}`, 404) // Do not pick an arbitrary instance for old routes.
  expect(standalone.id).not.toBe(otherSpace.id)

  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: credentials })
  const cookies = login.headers['set-cookie']
  const cookie = (Array.isArray(cookies) ? cookies : [String(cookies)]).map(value => value.split(';')[0]).join('; ')
  const objectUrl = `${base}/${space.slug}/objects/note.md`
  const uploaded = await app.inject({ method: 'PUT', url: objectUrl, headers: { cookie, 'content-type': 'text/markdown' }, payload: '# Shared content' })
  expect(uploaded.statusCode).toBe(201)
  const objects = await app.db.selectFrom('space_objects').selectAll().where('space_id', '=', space.id).execute()
  const versions = await app.db.selectFrom('space_object_versions').selectAll().where('space_id', '=', space.id).execute()
  const spaceBefore = await app.db.selectFrom('spaces').selectAll().where('id', '=', space.id).executeTakeFirstOrThrow()
  await deleteAppInstance(...args, second.id)
  expect(await listAppInstances(...args)).toEqual([])
  expect(await app.db.selectFrom('spaces').selectAll().where('id', '=', space.id).executeTakeFirstOrThrow()).toEqual(spaceBefore)
  expect(await app.db.selectFrom('space_objects').selectAll().where('space_id', '=', space.id).execute()).toEqual(objects)
  expect(await app.db.selectFrom('space_object_versions').selectAll().where('space_id', '=', space.id).execute()).toEqual(versions)
  const download = await app.inject({ url: objectUrl, headers: { cookie } })
  expect(download.statusCode).toBe(200)
  expect(download.body).toBe('# Shared content')
  await expect(getAppInstance(app.db, user.id, 'note', second.id)).rejects.toMatchObject({ statusCode: 404 })
  await owner.request('DELETE', `${base}/${space.slug}`, 204)
  expect(await app.db.selectFrom('space_apps').selectAll().where('space_id', '=', space.id).execute()).toEqual([])
  expect(await app.db.selectFrom('space_objects').selectAll().where('space_id', '=', space.id).execute()).toEqual([])
})

test('storage and identity constraints hold at the service and database boundaries', async ({ onTestFinished }) => {
  const { app, session } = await createFixture({ after: cleanup => onTestFinished(cleanup), diagnostic: message => console.info(message) })
  const owner = session()
  const credentials = { email: 'constraints@example.com', password: 'Apps-test-1234' }
  const user = await owner.request<PublicUser>('POST', '/users', 201, { ...credentials, displayName: 'Owner' })
  await owner.request('POST', '/auth/login', 200, credentials)
  const namespace = await app.db.selectFrom('namespaces').selectAll().where('owner_user_id', '=', user.id).executeTakeFirstOrThrow()
  const base = `/namespaces/${namespace.slug}/spaces`
  const objectSpace = await owner.request<PublicSpace>('POST', base, 201, { name: 'Files', slug: 'files', type: 'object' })
  const gitSpace = await owner.request<PublicSpace>('POST', base, 201, { name: 'Repository', slug: 'repository', type: 'git' })
  const constraintSpace = await owner.request<PublicSpace>('POST', base, 201, { name: 'Constraints', slug: 'constraints', type: 'object' })
  const raceSpace = await owner.request<PublicSpace>('POST', base, 201, { name: 'Race', slug: 'race', type: 'object' })
  const args = [app.db, user.id, namespace.slug, objectSpace.slug] as const
  const concurrent = await Promise.allSettled([
    createAppInstance(app.db, user.id, namespace.slug, raceSpace.slug, { appType: 'note' }),
    createAppInstance(app.db, user.id, namespace.slug, raceSpace.slug, { appType: 'media' }),
  ])
  expect(concurrent.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(concurrent.filter(result => result.status === 'rejected').map(result => result.reason)).toMatchObject([{ statusCode: 409 }])
  expect(await app.db.selectFrom('space_apps').select('id').where('space_id', '=', raceSpace.id).execute()).toHaveLength(1)
  await expect(createAppInstance(...args, { appType: 'unknown' })).rejects.toMatchObject({ statusCode: 400 })
  await expect(createAppInstance(...args, { appType: 'media', name: ' ' })).rejects.toMatchObject({ statusCode: 400 })
  await expect(createAppInstance(...args, { appType: 'media', config: { unsafe: true } })).rejects.toMatchObject({ statusCode: 400 })
  await expect(createAppInstance(app.db, user.id, namespace.slug, gitSpace.slug, { appType: 'media' })).rejects.toMatchObject({ statusCode: 400 })
  await app.db.insertInto('app_types').values({ type: 'custom-view', name: 'Custom', storage_type: 'object', kind: 'custom', owner_user_id: user.id }).execute()
  const custom = await createAppInstance(...args, { appType: 'custom-view' })
  const other = await session().request<PublicUser>('POST', '/users', 201, { email: 'other@example.com', password: credentials.password, displayName: 'Other' })
  await app.db.insertInto('namespace_members').values({ namespace_id: namespace.id, user_id: other.id, role: 'member' }).execute()
  await app.db.updateTable('space_members').set({ role: 'writer' }).where('space_id', '=', objectSpace.id).where('user_id', '=', user.id).execute()
  await app.db.insertInto('space_members').values({ space_id: objectSpace.id, user_id: other.id, role: 'owner' }).execute()
  await expect(createAppInstance(app.db, other.id, namespace.slug, objectSpace.slug, { appType: 'custom-view' })).rejects.toMatchObject({ statusCode: 403 })
  await expect(app.db.insertInto('space_apps').values({
    space_id: objectSpace.id, app_type: 'media', storage_type: 'object', name: 'Duplicate',
  }).execute()).rejects.toMatchObject({ code: '23505', constraint: 'space_apps_space_id_unique' })
  const values = { space_id: constraintSpace.id, app_type: 'media', storage_type: 'object' as const, name: 'App' }
  for (const invalid of [{ space_id: gitSpace.id }, { app_type: 'unknown' }, { storage_type: 'git' as const }, { space_id: randomUUID() }]) {
    await expect(app.db.insertInto('space_apps').values({ ...values, ...invalid }).execute()).rejects.toMatchObject({ code: '23503' })
  }
  for (const patch of [{ id: randomUUID() }, { space_id: gitSpace.id }, { app_type: 'media' }, { storage_type: 'git' as const }, { created_at: new Date(0) }]) {
    await expect(app.db.updateTable('space_apps').set(patch).where('id', '=', custom.id).execute()).rejects.toMatchObject({ code: '23514' })
  }
  await expect(app.db.updateTable('spaces').set({ type: 'git' }).where('id', '=', objectSpace.id).execute()).rejects.toMatchObject({ code: '23503' })
  await expect(app.db.updateTable('app_types').set({ storage_type: 'git' }).where('type', '=', 'custom-view').execute()).rejects.toMatchObject({ code: '23503' })
  await expect(app.db.deleteFrom('app_types').where('type', '=', 'custom-view').execute()).rejects.toMatchObject({ code: '23503' })
  for (const name of [' ', 'a'.repeat(101)]) {
    await expect(app.db.insertInto('space_apps').values({ ...values, name }).execute()).rejects.toMatchObject({ code: '23514' })
  }
  for (const config of ['[]', 'null', JSON.stringify({ text: 'x'.repeat(32768) })]) {
    await expect(sql`UPDATE space_apps SET config = ${config}::jsonb WHERE id = ${custom.id}`.execute(app.db)).rejects.toMatchObject({ code: '23514' })
  }
  for (const pwa of [{}, { ...pwaDefaults, enabled: 'yes' }, { ...pwaDefaults, offlinePolicy: 'all' }, { ...pwaDefaults, offlinePolicy: null },
    { ...pwaDefaults, iconObjectId: 'bad' }, { ...pwaDefaults, themeColor: 'red' }, { ...pwaDefaults, unknown: true }]) {
    await expect(sql`UPDATE space_apps SET pwa = ${JSON.stringify(pwa)}::jsonb WHERE id = ${custom.id}`.execute(app.db)).rejects.toMatchObject({ code: '23514' })
  }

  // Legacy creation and storage-error compensation must include the instance.
  const failingStorage = vi.spyOn(storage, 'createSpaceStorage').mockRejectedValueOnce(new Error('Test storage failure'))
  try {
    await owner.request('POST', base, 500, { name: 'Failed', slug: 'failed-create', type: 'object', app: 'media' })
  } finally { failingStorage.mockRestore() }
  expect(await app.db.selectFrom('spaces').select('id').where('slug', '=', 'failed-create').execute()).toEqual([])
  expect(await app.db.selectFrom('space_apps').select('id').where('name', '=', 'Failed').execute()).toEqual([])
  expect(await app.db.selectFrom('audit_events').select('id').where(sql<boolean>`metadata->>'slug' = 'failed-create'`).execute()).toEqual([])
})
