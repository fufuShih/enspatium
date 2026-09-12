import { test, expect, vi } from 'vitest'
import { sql } from 'kysely'
import { createFixture } from './fixture.js'
import { migrateDatabase } from '../src/db/migrations.js'
import type { PublicSpace } from '../src/db/types/space.types.js'
import type { PublicUser } from '../src/db/types/user.types.js'
import type { PublicNamespace } from '../src/db/types/namespace.types.js'
import * as plugins from '../src/apps/registry.js'
import type { ObjectAppPlugin } from '../src/apps/types.js'
import type { PublicSpaceObject } from '../src/db/types/object.types.js'

test('app registry preserves existing Spaces and resolves registered built-in and custom types with Space permissions', async ({ onTestFinished }) => {
  const { app, schema, session } = await createFixture({
    after: cleanup => onTestFinished(cleanup), diagnostic: message => console.info(message),
    migrationTarget: '0012_add_space_app',
  })
  const owner = session()
  const credentials = { email: 'apps-owner@example.com', password: 'Apps-test-1234' }
  const user = await owner.request<PublicUser>('POST', '/users', 201, { ...credentials, displayName: 'Apps owner' })
  // Seed the old schema before exercising the current session API after upgrade.
  const namespace = await app.db.selectFrom('namespaces').select(['id', 'slug']).where('owner_user_id', '=', user.id).executeTakeFirstOrThrow()
  const base = `/namespaces/${namespace!.slug}/spaces`
  const legacy = (await sql<{ id: string }>`insert into spaces (namespace_id, created_by_user_id, name, slug, type, app) values (${namespace!.id}, ${user.id}, 'Existing media', 'existing-media', 'object', 'media') returning id`.execute(app.db)).rows[0]!
  const plain = (await sql<{ id: string }>`insert into spaces (namespace_id, created_by_user_id, name, slug, type, app) values (${namespace!.id}, ${user.id}, 'Existing files', 'existing-files', 'object', null) returning id`.execute(app.db)).rows[0]!
  const migrated = await migrateDatabase(app.db, schema)
  expect(migrated.error).toBeUndefined()
  expect(await owner.request('POST', '/auth/login', 200, credentials)).toMatchObject({ isAdmin: false })
  expect((await migrateDatabase(app.db, schema)).results).toEqual([])
  expect(await app.db.selectFrom('spaces').select(['id', 'app_type']).where('id', 'in', [legacy.id, plain.id]).execute()).toEqual(expect.arrayContaining([{ id: legacy.id, app_type: 'media' }, { id: plain.id, app_type: null }]))
  const guest = session()
  const ebook = { type: 'ebook', name: 'Ebook library', kind: 'builtin', ownerUserId: null, storageType: 'object' }
  const builtin = { type: 'media', name: 'Media', kind: 'builtin', ownerUserId: null, storageType: 'object' }
  const note = { type: 'note', name: 'Note', kind: 'builtin', ownerUserId: null, storageType: 'object' }
  expect(await guest.request('GET', '/apps')).toEqual([ebook, builtin, note])
  expect(await owner.request('GET', `/apps/media/spaces/${legacy.id}`)).toMatchObject({ id: legacy.id, app: builtin })
  await guest.request('GET', `/apps/media/spaces/${legacy.id}`, 401)
  await owner.request('GET', `/apps/wiki/spaces/${legacy.id}`, 404)
  await owner.request('GET', `/apps/media/spaces/${plain.id}`, 404)
  await owner.request('POST', base, 400, { name: 'Unknown', slug: 'unknown-app', type: 'object', app: 'unknown' })
  await owner.request('POST', base, 400, { name: 'Wrong storage', slug: 'wrong-storage', type: 'git', app: 'media' })
  await owner.request('POST', base, 201, { name: 'Repository', slug: 'repository', type: 'git' })
  await owner.request('GET', base + '/repository/media', 404)

  // Metadata registration only: no external code or app installation is involved.
  await app.db.insertInto('app_types').values({ type: 'owner-wiki', name: 'My Wiki', kind: 'custom', owner_user_id: user.id, storage_type: 'object' }).execute()
  const custom = await owner.request<PublicSpace>('POST', base, 201, { name: 'Notes', slug: 'notes', type: 'object', app: 'owner-wiki' })
  const customUrl = `/apps/owner-wiki/spaces/${custom.id}`
  expect(await owner.request('GET', customUrl)).toMatchObject({ id: custom.id, app: { type: 'owner-wiki', kind: 'custom', ownerUserId: user.id } })
  const customApi = base + '/notes/owner-wiki'
  await owner.request('GET', customApi, 404) // A DB record alone does not install executable behavior.
  const originalLookup = plugins.getObjectAppPlugin
  const testPlugin: ObjectAppPlugin = { type: 'owner-wiki', storageType: 'object', kinds: [
    { kind: 'document', contentTypes: ['text/markdown'], extensions: ['md'], contentType: 'text/markdown' },
  ] }
  const lookup = vi.spyOn(plugins, 'getObjectAppPlugin').mockImplementation(type => type === testPlugin.type ? testPlugin : originalLookup(type))
  onTestFinished(() => { lookup.mockRestore() })
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: credentials })
  const cookies = login.headers['set-cookie']
  const cookie = (Array.isArray(cookies) ? cookies : [String(cookies)]).map(value => value.split(';')[0]).join('; ')
  const uploaded = await app.inject({ method: 'PUT', url: base + '/notes/objects/note.md', headers: { cookie, 'content-type': 'application/octet-stream' }, payload: '# My note' })
  expect(uploaded.statusCode).toBe(201)
  const item = uploaded.json<PublicSpaceObject>()
  expect(await owner.request('GET', customApi)).toMatchObject({ objects: [{ id: item.id, kind: 'document' }] })
  expect(await owner.request('GET', customApi + '/' + item.id)).toMatchObject({ id: item.id, kind: 'document' })
  await owner.request('GET', customApi + '?kind=video', 400)
  await owner.request('GET', base + '/notes/media', 404)
  await owner.request('GET', base + '/notes/unknown-app', 404)
  await owner.request('GET', base + '/notes/members') // The existing static resource still wins.
  expect(await owner.request('GET', '/apps')).toEqual(expect.arrayContaining([builtin, expect.objectContaining({ type: 'owner-wiki' })]))
  expect(await guest.request('GET', '/apps')).toEqual([ebook, builtin, note])
  await guest.request('GET', customUrl, 401)

  const other = session()
  const otherCredentials = { email: 'apps-other@example.com', password: credentials.password }
  await other.request('POST', '/users', 201, { ...otherCredentials, displayName: 'Other user' })
  await other.request('POST', '/auth/login', 200, otherCredentials)
  const [otherNamespace] = await other.request<PublicNamespace[]>('GET', '/namespaces')
  expect(await other.request('GET', '/apps')).toEqual([ebook, builtin, note])
  await other.request('GET', customUrl, 403)
  await other.request('POST', `/namespaces/${otherNamespace!.slug}/spaces`, 403, { name: 'Not mine', slug: 'not-mine', type: 'object', app: 'owner-wiki' })
  await owner.request('PATCH', base + '/notes', 200, { visibility: 'public' })
  expect(await guest.request('GET', customUrl)).toMatchObject({ id: custom.id })
  expect(await guest.request('GET', customApi)).toMatchObject({ canUpload: false, objects: [{ id: item.id, kind: 'document' }] })
  const contentUrl = customApi + '/content?' + new URLSearchParams({ key: item.key, versionId: item.versionId })
  const range = await app.inject({ url: contentUrl, headers: { range: 'bytes=0-3' } })
  expect(range.statusCode).toBe(206)
  expect(range.body).toBe('# My')
  expect(range.headers['content-type']).toBe('text/markdown')
  await owner.request('PATCH', base + '/notes', 200, { visibility: 'private' })
  await guest.request('GET', customUrl, 401)
  await guest.request('GET', customApi, 401)

  await expect(app.db.insertInto('app_types').values({ type: 'missing-owner', name: 'Invalid', kind: 'custom', owner_user_id: null, storage_type: 'object' }).execute()).rejects.toMatchObject({ code: '23514' })
  await expect(app.db.insertInto('app_types').values({ type: 'media', name: 'Collision', kind: 'custom', owner_user_id: user.id, storage_type: 'object' }).execute()).rejects.toMatchObject({ code: '23505' })
  await expect(app.db.updateTable('spaces').set({ type: 'git' }).where('id', '=', legacy.id).execute()).rejects.toMatchObject({ code: '23503' })
  await expect(app.db.updateTable('spaces').set({ app_type: 'unregistered' }).where('id', '=', plain.id).execute()).rejects.toMatchObject({ code: '23503' })
  await expect(app.db.deleteFrom('app_types').where('type', '=', 'owner-wiki').execute()).rejects.toMatchObject({ constraint: 'spaces_app_type_storage_fk' })
  for (const type of ['git', 'object', 'objects', 'members', 'storage', 'object-tree', 'object-head', 'object-versions', 'audit-events']) {
    await expect(app.db.insertInto('app_types').values({ type, name: 'Reserved', kind: 'builtin', storage_type: 'object', owner_user_id: null }).execute()).rejects.toMatchObject({ constraint: 'app_types_reserved_routes' })
  }
})
