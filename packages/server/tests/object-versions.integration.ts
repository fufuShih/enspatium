import { test, expect } from 'vitest'
import { readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sql } from 'kysely'
import { createFixture } from './fixture.js'
import { migrateDatabase } from '../src/db/migrations.js'
import { writeObjectFile } from '../src/services/object/storage.js'
import { Readable } from 'node:stream'
import type { PublicSpaceObject, ObjectVersionPage } from '../src/db/types/object.types.js'
import { createSpaceStorage } from '../src/services/space/storage.js'
import type { PublicUser } from '../src/db/types/user.types.js'

test('legacy objects become immutable first versions; writes, history, recovery and quota stay consistent', async ({ onTestFinished }) => {
  const { app, origin, root, schema, session } = await createFixture({
    after: cleanup => onTestFinished(cleanup), diagnostic: message => console.info(message),
    migrationTarget: '0009_add_space_quota',
  })
  const owner = session()
  const credentials = { email: 'versions@example.com', password: 'Version-test-1234' }
  const user = await owner.request<PublicUser>('POST', '/users', 201, { ...credentials, displayName: 'Version owner' })
  const namespaces = await app.db.selectFrom('namespaces').select(['id', 'slug', 'kind']).where('owner_user_id', '=', user.id).execute()
  const namespace = namespaces.find(n => n.kind === 'personal')!.slug
  const base = `/namespaces/${namespace}/spaces/versions`
  // Seed the old schema directly; the current create API requires later columns.
  const space = await app.db.insertInto('spaces').values({ name: 'Versions', slug: 'versions', type: 'object', visibility: 'public',
    namespace_id: namespaces.find(n => n.slug === namespace)!.id, created_by_user_id: user.id }).returningAll().executeTakeFirstOrThrow()
  await app.db.insertInto('space_members').values({ space_id: space.id, user_id: user.id, role: 'owner' }).execute()
  await createSpaceStorage(join(root, 'data'), space.id, 'object')
  const key = 'docs/中文 %_#.txt'
  const content = 'Legacy bytes'
  const stored = await writeObjectFile(join(root, 'data'), space.id, key, Readable.from(content))
  const legacy = await app.db.insertInto('space_objects').values({ space_id: space.id, key,
    content_type: 'text/plain', size_bytes: stored.sizeBytes, checksum_sha256: stored.checksumSha256,
    created_by_user_id: user.id }).returningAll().executeTakeFirstOrThrow()
  const migrated = await migrateDatabase(app.db, schema)
  expect(migrated.error).toBeUndefined()
  expect(await owner.request('POST', '/auth/login', 200, credentials)).toMatchObject({ isAdmin: false })
  expect((await migrateDatabase(app.db, schema)).results).toEqual([])

  const login = await fetch(origin + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials) })
  const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  await login.arrayBuffer()
  const query = (params: Record<string, string | number>) => new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
  const history = (cursor?: number, limit = 30) => owner.request<ObjectVersionPage>('GET', base + '/object-versions?' + query({ key, limit, ...(cursor ? { cursor } : {}) }))
  async function upload(name: string, bytes: string, expectedVersion?: string, status = 201) {
    const response = await fetch(origin + base + '/objects/' + encodeURIComponent(name) + (expectedVersion ? '?' + query({ expectedVersion }) : ''), {
      method: 'PUT', headers: { cookie, 'content-type': 'text/plain' }, body: bytes,
    })
    const body = await response.json()
    expect(response.status, JSON.stringify(body)).toBe(status)
    return body as PublicSpaceObject
  }
  async function download(versionId?: string, expected = 200, name = key) {
    const url = versionId ? '/object-versions/content?' + query({ key: name, versionId }) : '/objects/' + encodeURIComponent(name)
    const response = await fetch(origin + base + url, { headers: { cookie } })
    const bytes = await response.text()
    expect(response.status).toBe(expected)
    return bytes
  }
  async function restore(versionId: string, expectedVersion: string, status = 201) {
    return owner.request<PublicSpaceObject>('POST', base + '/object-versions/restore?' + query({ key, versionId, expectedVersion }), status)
  }
  const first = (await history()).object
  expect(first).toMatchObject({ id: legacy.id, revision: 1, isDeleted: false })
  expect(await download(first.versionId)).toBe(content)
  const second = await upload(key, 'Second bytes', first.versionId)
  expect(second).toMatchObject({ id: first.id, revision: 2 })
  expect(second.versionId).not.toBe(first.versionId)
  expect(await download()).toBe('Second bytes')
  expect(await download(first.versionId)).toBe(content)
  expect(await readFile(join(root, 'data', space.id, ...key.split('/')), 'utf8')).toBe(content)
  await upload(key, 'Stale update', first.versionId, 409)
  const race = await Promise.all([
    fetch(origin + base + '/objects/' + encodeURIComponent(key) + '?' + query({ expectedVersion: second.versionId }), { method: 'PUT', headers: { cookie, 'content-type': 'text/plain' }, body: 'Concurrent A' }),
    fetch(origin + base + '/objects/' + encodeURIComponent(key) + '?' + query({ expectedVersion: second.versionId }), { method: 'PUT', headers: { cookie, 'content-type': 'text/plain' }, body: 'Concurrent B' }),
  ])
  expect(race.map(r => r.status).sort()).toEqual([201, 409])
  for (const response of race) await response.arrayBuffer()
  const third = (await history()).object
  const page = await history(undefined, 1)
  expect(page.versions.map(v => v.revision)).toEqual([3])
  expect((await history(page.nextCursor!, 1)).versions.map(v => v.revision)).toEqual([2])
  const restored = await restore(first.versionId, third.versionId)
  expect(restored.revision).toBe(4)
  expect(await download()).toBe(content)
  await restore(first.versionId, third.versionId, 409)

  // Failed metadata/audit writes leave the previous head and bytes unchanged.
  await sql`create function reject_version_audit() returns trigger language plpgsql as $$ begin raise exception 'test rejection'; end $$`.execute(app.db)
  await sql`create trigger reject_version_audit before insert on audit_events for each row execute function reject_version_audit()`.execute(app.db)
  const beforeFiles = await readdir(join(root, 'data', space.id))
  await upload(key, 'Must roll back', restored.versionId, 500)
  expect(await readdir(join(root, 'data', space.id))).toEqual(beforeFiles)
  expect((await history()).object.versionId).toBe(restored.versionId)
  await sql`drop trigger reject_version_audit on audit_events`.execute(app.db)

  const usage = await owner.request<{ usedBytes: number }>('GET', base + '/storage')
  await app.db.updateTable('spaces').set({ quota_bytes: String(usage.usedBytes) }).where('id', '=', space.id).execute()
  await upload(key, 'Full', restored.versionId, 413)
  await restore(first.versionId, restored.versionId, 413)
  await owner.request('DELETE', base + '/objects/' + encodeURIComponent(key) + '?' + query({ expectedVersion: restored.versionId }), 204)
  const deleted = (await history()).object
  expect(deleted).toMatchObject({ revision: 5, isDeleted: true })
  expect((await owner.request<{ usedBytes: number }>('GET', base + '/storage')).usedBytes).toBe(usage.usedBytes)
  await download(undefined, 404)
  expect(await download(first.versionId)).toBe(content)
  expect(await owner.request('GET', base + '/objects')).toEqual([])
  expect(await owner.request('GET', base + '/object-tree?deleted=true&prefix=docs%2F')).toMatchObject({ objects: [expect.objectContaining({ id: first.id })] })
  await app.db.updateTable('spaces').set({ quota_bytes: '1073741824' }).where('id', '=', space.id).execute()
  const child = await upload(key + '/child.txt', 'Child')
  await restore(first.versionId, deleted.versionId, 409)
  await owner.request('DELETE', base + '/objects/' + encodeURIComponent(child.key), 204)
  const recovered = await restore(first.versionId, deleted.versionId)
  expect(recovered).toMatchObject({ revision: 6, isDeleted: false })
  expect(await download()).toBe(content)

  const other = await upload('other.txt', 'Other')
  await download(other.versionId, 404)
  await restore(other.versionId, recovered.versionId, 404)
  const anonymous = session()
  await anonymous.request('GET', base + '/object-versions?' + query({ key }), 401)
  await anonymous.request('GET', base + '/object-versions/content?' + query({ key, versionId: first.versionId }), 401)
  expect(await (await fetch(origin + base + '/objects/' + encodeURIComponent(key))).text()).toBe(content)
  await anonymous.request('POST', base + '/object-versions/restore?' + query({ key, versionId: first.versionId, expectedVersion: recovered.versionId }), 401)
  const stranger = session()
  await stranger.request('POST', '/users', 201, { email: 'stranger@example.com', displayName: 'Stranger', password: credentials.password })
  await stranger.request('POST', '/auth/login', 200, { email: 'stranger@example.com', password: credentials.password })
  await stranger.request('POST', base + '/object-versions/restore?' + query({ key, versionId: first.versionId, expectedVersion: recovered.versionId }), 403)
  await owner.request('PATCH', base, 200, { visibility: 'private' })
  await stranger.request('GET', base + '/object-versions?' + query({ key }), 403)
  await stranger.request('GET', base + '/object-versions/content?' + query({ key, versionId: first.versionId }), 403)

  // Missing legacy content and unavailable storage must not become empty versions.
  const legacyPath = join(root, 'data', space.id, ...key.split('/'))
  await rename(legacyPath, legacyPath + '.offline')
  try { await download(first.versionId, 404); await restore(first.versionId, recovered.versionId, 404) }
  finally { await rename(legacyPath + '.offline', legacyPath) }
  await writeFile(legacyPath, 'Corrupt bytes')
  try { await restore(first.versionId, recovered.versionId, 409) }
  finally { await writeFile(legacyPath, content) }
  const storage = join(root, 'data', space.id)
  await rename(storage, storage + '.offline')
  try { await upload(key, 'Offline', recovered.versionId, 503); await restore(first.versionId, recovered.versionId, 503) }
  finally { await rename(storage + '.offline', storage) }
  expect((await history()).object.versionId).toBe(recovered.versionId)
  const events = await app.db.selectFrom('audit_events').selectAll().where('space_id', '=', space.id).execute()
  expect(events.some(e => e.metadata.restoredFromVersionId === first.versionId)).toBe(true)

  // Readers can inspect history but only writers can restore it. Revocation is
  // enforced on subsequent history and mutation requests.
  const team = '/namespaces/versions-team'
  await owner.request('POST', '/namespaces', 201, { name: 'Version team', slug: 'versions-team' })
  await owner.request('POST', team + '/members', 201, { email: 'stranger@example.com' })
  const sharedBase = team + '/spaces/shared'
  await owner.request('POST', team + '/spaces', 201, { name: 'Shared', slug: 'shared', type: 'object' })
  await owner.request('POST', sharedBase + '/members', 201, { email: 'stranger@example.com', role: 'reader' })
  const sharedVersions: PublicSpaceObject[] = []
  for (const bytes of ['Shared first', 'Shared second']) {
    const response = await fetch(origin + sharedBase + '/objects/file.txt', { method: 'PUT', headers: { cookie, 'content-type': 'text/plain' }, body: bytes })
    expect(response.status).toBe(201)
    sharedVersions.push(await response.json() as PublicSpaceObject)
  }
  expect((await stranger.request<ObjectVersionPage>('GET', sharedBase + '/object-versions?key=file.txt')).versions).toHaveLength(2)
  const restoreQuery = query({ key: 'file.txt', versionId: sharedVersions[0]!.versionId, expectedVersion: sharedVersions[1]!.versionId })
  await stranger.request('POST', sharedBase + '/object-versions/restore?' + restoreQuery, 403)
  await stranger.request('DELETE', sharedBase + '/objects/file.txt', 403)
  const strangerUser = await stranger.request<PublicUser>('GET', '/auth/me')
  await owner.request('PATCH', sharedBase + '/members/' + strangerUser.id, 200, { role: 'writer' })
  await stranger.request('POST', sharedBase + '/object-versions/restore?' + restoreQuery, 201)
  await owner.request('DELETE', sharedBase + '/members/' + strangerUser.id, 204)
  await stranger.request('GET', sharedBase + '/object-versions?key=file.txt', 403)
  await stranger.request('POST', sharedBase + '/object-versions/restore?' + restoreQuery, 403)
  await owner.request('DELETE', base, 204)
  expect(await app.db.selectFrom('space_object_versions').selectAll().where('space_id', '=', space.id).execute()).toEqual([])
})
