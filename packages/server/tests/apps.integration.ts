import { test, expect } from 'vitest'
import { createFixture } from './fixture.js'
import { migrateDatabase } from '../src/db/migrations.js'
import type { PublicSpace } from '../src/db/space.types.js'
import type { PublicUser } from '../src/db/user.types.js'
import type { PublicNamespace } from '../src/db/namespace.types.js'

test('app registry preserves existing Spaces and resolves registered built-in and custom types with Space permissions', async ({ onTestFinished }) => {
  const { app, schema, session } = await createFixture({
    after: cleanup => onTestFinished(cleanup), diagnostic: message => console.info(message),
    migrationTarget: '0012_add_space_app',
  })
  const owner = session()
  const credentials = { email: 'apps-owner@example.com', password: 'Apps-test-1234' }
  const user = await owner.request<PublicUser>('POST', '/users', 201, { ...credentials, displayName: 'Apps owner' })
  await owner.request('POST', '/auth/login', 200, credentials)
  const [namespace] = await owner.request<PublicNamespace[]>('GET', '/namespaces')
  const base = `/namespaces/${namespace!.slug}/spaces`
  const legacy = await app.db.insertInto('spaces').values({ namespace_id: namespace!.id, created_by_user_id: user.id, name: 'Existing media', slug: 'existing-media', type: 'object', app: 'media' }).returningAll().executeTakeFirstOrThrow()
  const plain = await app.db.insertInto('spaces').values({ namespace_id: namespace!.id, created_by_user_id: user.id, name: 'Existing files', slug: 'existing-files', type: 'object', app: null }).returningAll().executeTakeFirstOrThrow()
  const migrated = await migrateDatabase(app.db, schema)
  expect(migrated.error).toBeUndefined()
  expect((await migrateDatabase(app.db, schema)).results).toEqual([])
  expect(await app.db.selectFrom('spaces').select(['id', 'app']).where('id', 'in', [legacy.id, plain.id]).execute()).toEqual(expect.arrayContaining([{ id: legacy.id, app: 'media' }, { id: plain.id, app: null }]))
  const guest = session()
  const builtin = { type: 'media', name: 'Media', kind: 'builtin', ownerUserId: null, storageType: 'object' }
  expect(await guest.request('GET', '/apps')).toEqual([builtin])
  expect(await owner.request('GET', `/apps/media/spaces/${legacy.id}`)).toMatchObject({ id: legacy.id, app: builtin })
  await guest.request('GET', `/apps/media/spaces/${legacy.id}`, 401)
  await owner.request('GET', `/apps/wiki/spaces/${legacy.id}`, 404)
  await owner.request('GET', `/apps/media/spaces/${plain.id}`, 404)
  await owner.request('POST', base, 400, { name: 'Unknown', slug: 'unknown-app', type: 'object', app: 'unknown' })
  await owner.request('POST', base, 400, { name: 'Wrong storage', slug: 'wrong-storage', type: 'git', app: 'media' })

  // Metadata registration only: no external code or app installation is involved.
  await app.db.insertInto('apps').values({ type: 'owner-wiki', name: 'My Wiki', kind: 'custom', owner_user_id: user.id, storage_type: 'object' }).execute()
  const custom = await owner.request<PublicSpace>('POST', base, 201, { name: 'Notes', slug: 'notes', type: 'object', app: 'owner-wiki' })
  const customUrl = `/apps/owner-wiki/spaces/${custom.id}`
  expect(await owner.request('GET', customUrl)).toMatchObject({ id: custom.id, app: { type: 'owner-wiki', kind: 'custom', ownerUserId: user.id } })
  expect(await owner.request('GET', '/apps')).toEqual(expect.arrayContaining([builtin, expect.objectContaining({ type: 'owner-wiki' })]))
  expect(await guest.request('GET', '/apps')).toEqual([builtin])
  await guest.request('GET', customUrl, 401)

  const other = session()
  const otherCredentials = { email: 'apps-other@example.com', password: credentials.password }
  await other.request('POST', '/users', 201, { ...otherCredentials, displayName: 'Other user' })
  await other.request('POST', '/auth/login', 200, otherCredentials)
  const [otherNamespace] = await other.request<PublicNamespace[]>('GET', '/namespaces')
  expect(await other.request('GET', '/apps')).toEqual([builtin])
  await other.request('GET', customUrl, 403)
  await other.request('POST', `/namespaces/${otherNamespace!.slug}/spaces`, 403, { name: 'Not mine', slug: 'not-mine', type: 'object', app: 'owner-wiki' })
  await owner.request('PATCH', base + '/notes', 200, { visibility: 'public' })
  expect(await guest.request('GET', customUrl)).toMatchObject({ id: custom.id })
  await owner.request('PATCH', base + '/notes', 200, { visibility: 'private' })
  await guest.request('GET', customUrl, 401)

  await expect(app.db.insertInto('apps').values({ type: 'missing-owner', name: 'Invalid', kind: 'custom', owner_user_id: null, storage_type: 'object' }).execute()).rejects.toMatchObject({ code: '23514' })
  await expect(app.db.insertInto('apps').values({ type: 'media', name: 'Collision', kind: 'custom', owner_user_id: user.id, storage_type: 'object' }).execute()).rejects.toMatchObject({ code: '23505' })
  await expect(app.db.updateTable('spaces').set({ type: 'git' }).where('id', '=', legacy.id).execute()).rejects.toMatchObject({ code: '23503' })
  await expect(app.db.updateTable('spaces').set({ app: 'unregistered' }).where('id', '=', plain.id).execute()).rejects.toMatchObject({ code: '23503' })
  await expect(app.db.deleteFrom('apps').where('type', '=', 'owner-wiki').execute()).rejects.toMatchObject({ constraint: 'spaces_app_storage_fk' })
})
