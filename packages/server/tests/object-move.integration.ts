import { mkdir, rename, readFile, readdir } from 'node:fs/promises'
import { join, relative, isAbsolute } from 'node:path'
import { sql } from 'kysely'
import { expect, test } from 'vitest'
import { createFixture } from './fixture.js'
import type { PublicSpaceObject, ObjectVersionPage, ObjectStorageUsage } from '../src/db/types/object.types.js'
import type { PublicSpace } from '../src/db/types/space.types.js'
import type { PublicUser } from '../src/db/types/user.types.js'
import { withStorageCheck } from '../src/services/space/storage-access.js'

test('moves preserve content and history, serialize conflicts, and enforce write access without filesystem moves', async ({ onTestFinished }) => {
  const { app, root, session } = await createFixture({ after: cleanup => onTestFinished(cleanup), diagnostic: message => console.info(message) })
  const owner = session()
  const reader = session()
  const credentials = { email: 'move-owner@example.com', password: 'Move-test-1234' }
  await owner.request('POST', '/users', 201, { ...credentials, displayName: 'Owner' })
  await owner.request('POST', '/auth/login', 200, credentials)
  const member = await reader.request<PublicUser>('POST', '/users', 201, { email: 'move-reader@example.com', password: credentials.password, displayName: 'Reader' })
  await reader.request('POST', '/auth/login', 200, { email: member.email, password: credentials.password })
  await owner.request('POST', '/namespaces', 201, { name: 'Move team', slug: 'move-team' })
  const space = await owner.request<PublicSpace>('POST', '/namespaces/move-team/spaces', 201, { name: 'Files', slug: 'files', type: 'object' })
  const base = '/namespaces/move-team/spaces/files'
  await owner.request('POST', '/namespaces/move-team/members', 201, { email: member.email })
  await owner.request('POST', base + '/members', 201, { email: member.email, role: 'reader' })
  const upload = (key: string, content = key) => owner.request<PublicSpaceObject>('PUT', base + '/objects/' + encodeURIComponent(key), 201, content)
  const moveUrl = (object: PublicSpaceObject, newKey: string) => base + '/object-move?' + new URLSearchParams({ objectId: object.id, key: object.key, newKey, expectedVersion: object.versionId })
  const move = (object: PublicSpaceObject, newKey: string, status = 200) => owner.request<PublicSpaceObject>('POST', moveUrl(object, newKey), status)
  const head = (key: string) => owner.request<PublicSpaceObject | null>('GET', base + '/object-head?' + new URLSearchParams({ key }))
  const first = await upload('legacy/original.txt', 'first')
  // Simulate a migrated version whose storage locator is still a logical path.
  const directory = join(root, 'data', space.id)
  const legacyPath = join(directory, 'legacy', 'original.txt')
  for (const path of [join(directory, first.versionId), legacyPath]) {
    const within = relative(directory, path)
    expect(!within.startsWith('..') && !isAbsolute(within)).toBe(true)
  }
  await mkdir(join(directory, 'legacy'))
  await rename(join(directory, first.versionId), legacyPath)
  await app.db.updateTable('space_object_versions').set({ storage_key: first.key }).where('id', '=', first.versionId).execute()
  const second = await upload(first.key, 'second')
  const versionsBefore = await app.db.selectFrom('space_object_versions').selectAll().where('object_id', '=', first.id).orderBy('revision').execute()
  const filesBefore = (await readdir(directory, { recursive: true })).sort()
  const usage = await owner.request<ObjectStorageUsage>('GET', base + '/storage')
  await reader.request('POST', moveUrl(second, 'denied.txt'), 403)
  await session().request('POST', moveUrl(second, 'anonymous.txt'), 401)
  const moved = await move(second, 'books/中文 #%.txt')
  expect(moved).toMatchObject({ id: second.id, versionId: second.versionId, revision: second.revision, checksumSha256: second.checksumSha256, sizeBytes: second.sizeBytes, key: 'books/中文 #%.txt' })
  expect(await head(second.key)).toBeNull()
  expect(await owner.request('GET', base + '/objects/' + encodeURIComponent(moved.key))).toBe('second')
  expect(await owner.request('GET', base + '/object-versions/content?' + new URLSearchParams({ key: moved.key, versionId: first.versionId }))).toBe('first')
  expect(await owner.request('GET', base + '/storage')).toEqual(usage)
  expect(await app.db.selectFrom('space_object_versions').selectAll().where('object_id', '=', first.id).orderBy('revision').execute()).toEqual(versionsBefore)
  expect((await readdir(directory, { recursive: true })).sort()).toEqual(filesBefore)
  expect(await readFile(legacyPath, 'utf8')).toBe(JSON.stringify('first'))
  expect(await move(second, moved.key)).toEqual(moved) // Lost-response retry.
  expect(await move(moved, moved.key)).toEqual(moved) // No-op.
  const audit = await app.db.selectFrom('audit_events').selectAll().where('space_id', '=', space.id).where('action', '=', 'object.moved').execute()
  expect(audit).toHaveLength(1)
  expect(audit[0]!.metadata).toMatchObject({ oldKey: second.key, newKey: moved.key, objectId: first.id })
  await move(second, 'stale-key.txt', 409)
  await move({ ...moved, versionId: first.versionId }, 'stale-version.txt', 409)
  for (const name of ['occupied.txt', 'parent', 'folder/child.txt', 'deleted.txt', 'wild%_#/child.txt']) await upload(name)
  await owner.request('DELETE', base + '/objects/deleted.txt', 204)
  for (const name of ['occupied.txt', 'parent/child.txt', 'folder', 'deleted.txt', 'wild%_#']) {
    expect(await move(moved, name, 409)).toMatchObject({ code: 'OBJECT_KEY_CONFLICT' })
  }
  for (const name of ['../escape', '/absolute', 'a//b', 'a/../b', 'CON', 'a.']) await move(moved, name, 400)
  await owner.request('POST', base + '/object-move?' + new URLSearchParams({ objectId: moved.id, key: moved.key, newKey: 'missing-version.txt' }), 400)
  const otherSpace = await owner.request<PublicSpace>('POST', '/namespaces/move-team/spaces', 201, { name: 'Other', slug: 'other', type: 'object' })
  const other = await owner.request<PublicSpaceObject>('PUT', '/namespaces/move-team/spaces/other/objects/other.txt', 201, 'other')
  await move(other, 'cross-space.txt', 404)
  expect(other.spaceId).toBe(otherSpace.id)
  await withStorageCheck(join(root, 'data'), () => move(moved, 'busy.txt', 409))

  // Two files racing for a destination cannot overwrite either version history.
  const a = await upload('race-a.txt')
  const b = await upload('race-b.txt')
  const outcomes = await Promise.allSettled([move(a, 'race-winner.txt'), move(b, 'race-winner.txt')])
  expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  for (const result of outcomes) if (result.status === 'rejected') expect(result.reason).toMatchObject({ actual: 409 })
  const survivor = await head('race-winner.txt')
  expect([a.id, b.id]).toContain(survivor!.id)
  expect(await head(survivor!.id === a.id ? b.key : a.key)).not.toBeNull()
  const same = await upload('same.txt')
  const sameRace = await Promise.allSettled([move(same, 'same-one.txt'), move(same, 'same-two.txt')])
  expect(sameRace.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  for (const result of sameRace) if (result.status === 'rejected') expect(result.reason).toMatchObject({ actual: 409 })
  // The source itself must not count as a folder/file collision.
  const own = await upload('own')
  const nested = await move(own, 'own/nested.txt')
  await move(nested, 'own')

  // Metadata and audit are committed together; audit failure rolls back the move.
  await sql`create function reject_move_audit() returns trigger language plpgsql as $$ begin if NEW.action = 'object.moved' then raise exception 'test rejection'; end if; return NEW; end $$`.execute(app.db)
  await sql`create trigger reject_move_audit before insert on audit_events for each row execute function reject_move_audit()`.execute(app.db)
  await move(moved, 'rollback.txt', 500)
  expect((await head(moved.key))!.id).toBe(moved.id)
  expect(await head('rollback.txt')).toBeNull()
  await sql`drop trigger reject_move_audit on audit_events`.execute(app.db)

  await owner.request('PATCH', base + '/members/' + member.id, 200, { role: 'writer' })
  const byWriter = await reader.request<PublicSpaceObject>('POST', moveUrl(moved, 'writer.txt'))
  const restored = await owner.request<PublicSpaceObject>('POST', base + '/object-versions/restore?' + new URLSearchParams({ key: byWriter.key, versionId: first.versionId, expectedVersion: byWriter.versionId }), 201)
  expect(await owner.request('GET', base + '/objects/writer.txt')).toBe('first')
  await move(byWriter, 'old-version.txt', 409)
  await owner.request('DELETE', base + '/objects/writer.txt', 204)
  const deleted = (await head('writer.txt'))!
  await move(deleted, 'deleted-move.txt', 409)
  const history = await owner.request<ObjectVersionPage>('GET', base + '/object-versions?key=writer.txt')
  expect(history.versions.some(version => version.versionId === restored.versionId)).toBe(true)
})
