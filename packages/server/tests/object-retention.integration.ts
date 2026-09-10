import { test, expect, vi } from 'vitest'
import { access, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { sql } from 'kysely'
import { cleanupObjectSpace } from '../src/services/object/retention.js'
import * as storage from '../src/services/object/storage.js'
import type { PublicNamespace } from '../src/db/namespace.types.js'
import type { PublicSpace } from '../src/db/space.types.js'
import type { PublicSpaceObject } from '../src/db/object.types.js'
import { createFixture } from './fixture.js'

test('retention enforces count or inactive age, protects active content, and retries failed purges', async ({ onTestFinished }) => {
  const { app, root, session } = await createFixture({ after: cleanup => onTestFinished(cleanup), diagnostic: message => console.info(message) })
  const owner = session()
  const credentials = { email: 'retention@example.com', password: 'Retention-test-1234' }
  await owner.request('POST', '/users', 201, { ...credentials, displayName: 'Retention owner' })
  await owner.request('POST', '/auth/login', 200, credentials)
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: credentials })
  expect(login.statusCode).toBe(200)
  const setCookie = login.headers['set-cookie']
  const cookie = (Array.isArray(setCookie) ? setCookie : [String(setCookie)]).map(item => item.split(';')[0]).join('; ')
  const namespace = (await owner.request<PublicNamespace[]>('GET', '/namespaces')).find(n => n.kind === 'personal')!.slug
  const base = `/namespaces/${namespace}/spaces/retention`
  const space = await owner.request<PublicSpace>('POST', `/namespaces/${namespace}/spaces`, 201, { name: 'Retention', slug: 'retention', type: 'object' })
  expect(space).toMatchObject({ objectVersionLimit: 3, objectRetentionDays: 7 })
  const dataRoot = join(root, 'data')
  const spaceRoot = join(dataRoot, space.id)
  const day = 86_400_000
  async function upload(key: string, bytes: string) {
    const response = await app.inject({ method: 'PUT', url: base + '/objects/' + encodeURIComponent(key), headers: { cookie, 'content-type': 'text/plain' }, payload: bytes })
    expect(response.statusCode, response.body).toBe(201)
    return response.json<PublicSpaceObject>()
  }
  const record = (id: string) => app.db.selectFrom('space_object_versions').selectAll().where('id', '=', id).executeTakeFirst()
  const v1 = await upload('file.txt', 'a')
  const v2 = await upload('file.txt', 'bb')
  const v3 = await upload('file.txt', 'ccc')
  const v4 = await upload('file.txt', 'dddd')
  expect((await record(v4.versionId))?.inactive_at).toBeNull()
  expect((await record(v3.versionId))?.inactive_at).toBeInstanceOf(Date)
  await cleanupObjectSpace(app.db, dataRoot, space.id)
  expect(await record(v1.versionId)).toBeUndefined()
  await expect(access(join(spaceRoot, v1.versionId))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await owner.request('GET', base + '/storage')).toMatchObject({ usedBytes: 9 })

  const now = new Date()
  await app.db.updateTable('space_object_versions').set({ inactive_at: new Date(now.getTime() - 7 * day) }).where('id', '=', v2.versionId).execute()
  await app.db.updateTable('space_object_versions').set({ created_at: new Date(now.getTime() - 365 * day), inactive_at: new Date(now.getTime() - 7 * day + 1) }).where('id', '=', v3.versionId).execute()
  await app.db.updateTable('space_object_versions').set({ created_at: new Date(now.getTime() - 365 * day) }).where('id', '=', v4.versionId).execute()
  await cleanupObjectSpace(app.db, dataRoot, space.id, now)
  expect(await record(v2.versionId)).toBeUndefined()
  expect(await record(v3.versionId)).toBeDefined()
  await cleanupObjectSpace(app.db, dataRoot, space.id, new Date(now.getTime() + 1))
  expect(await record(v3.versionId)).toBeUndefined()
  expect(await record(v4.versionId)).toBeDefined()
  expect(await owner.request('GET', base + '/storage')).toMatchObject({ usedBytes: 4 })
  const current = await app.inject({ method: 'GET', url: base + '/objects/file.txt', headers: { cookie } })
  expect(current.body).toBe('dddd')

  // Settings are per Space, owner-only, validated, and not accepted by Git Spaces.
  for (const body of [{ objectVersionLimit: 0 }, { objectVersionLimit: 1.5 }, { objectVersionLimit: 1001 }, { objectRetentionDays: 0 }, { objectRetentionDays: 36501 }]) {
    await owner.request('PATCH', base, 400, body)
  }
  await owner.request('PATCH', base, 200, { objectVersionLimit: 1, objectRetentionDays: 2 })
  expect(await owner.request('GET', base)).toMatchObject({ objectVersionLimit: 1, objectRetentionDays: 2 })
  const other = await owner.request<PublicSpace>('POST', `/namespaces/${namespace}/spaces`, 201, { name: 'Other', slug: 'other', type: 'object' })
  expect(other).toMatchObject({ objectVersionLimit: 3, objectRetentionDays: 7 })
  await owner.request('POST', `/namespaces/${namespace}/spaces`, 201, { name: 'Git', slug: 'git', type: 'git' })
  await owner.request('PATCH', `/namespaces/${namespace}/spaces/git`, 400, { objectVersionLimit: 1 })
  const stranger = session()
  await stranger.request('POST', '/users', 201, { email: 'reader@example.com', password: credentials.password, displayName: 'Reader' })
  await stranger.request('POST', '/auth/login', 200, { email: 'reader@example.com', password: credentials.password })
  await stranger.request('PATCH', base, 403, { objectVersionLimit: 100 })

  const old = await upload('retry.txt', 'old')
  const active = await upload('retry.txt', 'new')
  await sql`create function reject_purge_audit() returns trigger language plpgsql as $$ begin if NEW.action = 'object.version_purged' then raise exception 'test failure'; end if; return NEW; end $$`.execute(app.db)
  await sql`create trigger reject_purge_audit before insert on audit_events for each row execute function reject_purge_audit()`.execute(app.db)
  await expect(cleanupObjectSpace(app.db, dataRoot, space.id)).rejects.toThrow()
  const pending = await record(old.versionId)
  expect(pending?.purge_started_at).toBeInstanceOf(Date)
  expect(await record(active.versionId)).toBeDefined()
  await expect(access(join(spaceRoot, old.versionId))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await owner.request('GET', base + '/storage')).toMatchObject({ usedBytes: 10 })
  await owner.request('GET', base + '/object-versions/content?key=retry.txt&versionId=' + old.versionId, 404)
  await owner.request('POST', base + '/object-versions/restore?key=retry.txt&versionId=' + old.versionId + '&expectedVersion=' + active.versionId, 404)
  await sql`drop trigger reject_purge_audit on audit_events`.execute(app.db)
  await owner.request('PATCH', base, 200, { objectVersionLimit: 100, objectRetentionDays: 36500 })
  // A purge already committed to removing bytes cannot be undone by raising limits.
  await Promise.all([cleanupObjectSpace(app.db, dataRoot, space.id), cleanupObjectSpace(app.db, dataRoot, space.id)])
  expect(await record(old.versionId)).toBeUndefined()
  expect(await owner.request('GET', base + '/storage')).toMatchObject({ usedBytes: 7 })
  const audits = await app.db.selectFrom('audit_events').selectAll().where('action', '=', 'object.version_purged').execute()
  expect(audits.filter(event => event.metadata.versionId === old.versionId)).toHaveLength(1)

  // Once replaced, even an old active file gets a fresh inactive timestamp.
  const next = await upload('file.txt', 'latest')
  expect((await record(v4.versionId))!.inactive_at!.getTime()).toBeGreaterThanOrEqual(now.getTime())
  await owner.request('PATCH', base, 200, { objectVersionLimit: 1, objectRetentionDays: 7 })
  await rename(spaceRoot, spaceRoot + '-offline')
  try { await expect(cleanupObjectSpace(app.db, dataRoot, space.id)).rejects.toMatchObject({ code: 'SPACE_STORAGE_UNAVAILABLE' }) }
  finally { await rename(spaceRoot + '-offline', spaceRoot) }
  expect((await record(v4.versionId))?.purge_started_at).toBeNull()
  expect(await record(next.versionId)).toBeDefined()
  await cleanupObjectSpace(app.db, dataRoot, space.id)

  // Deletion markers do not consume the content version allowance. Deleted
  // content expires from its inactive timestamp, then the empty shell is removed.
  await owner.request('DELETE', base + '/objects/retry.txt', 204)
  const marker = await app.db.selectFrom('space_objects').selectAll().where('id', '=', active.id).executeTakeFirstOrThrow()
  const inactive = (await record(active.versionId))!.inactive_at!
  await cleanupObjectSpace(app.db, dataRoot, space.id, new Date(inactive.getTime() + 7 * day - 1))
  expect(await record(active.versionId)).toBeDefined()
  await cleanupObjectSpace(app.db, dataRoot, space.id, new Date(Math.max(inactive.getTime(), marker.updated_at.getTime()) + 7 * day))
  expect(await record(active.versionId)).toBeUndefined()
  expect(await app.db.selectFrom('space_objects').select('id').where('id', '=', active.id).executeTakeFirst()).toBeUndefined()
  expect(await record(next.versionId)).toBeDefined()
  expect(await owner.request('GET', base + '/storage')).toMatchObject({ usedBytes: 6 })

  // Copying an old version does not allow restore to bypass a concurrently
  // committed purge. The new temporary copy is cleaned up on conflict.
  const raceOld = await upload('race.txt', 'before')
  const raceCurrent = await upload('race.txt', 'after')
  let copied!: () => void
  let resume!: () => void
  const copyReady = new Promise<void>(resolve => { copied = resolve })
  const continueRestore = new Promise<void>(resolve => { resume = resolve })
  const write = storage.writeObjectFile
  const interception = vi.spyOn(storage, 'writeObjectFile').mockImplementationOnce(async (...args) => {
    const result = await write(...args)
    copied()
    await continueRestore
    return result
  })
  const restoring = owner.request('POST', base + '/object-versions/restore?key=race.txt&versionId=' + raceOld.versionId + '&expectedVersion=' + raceCurrent.versionId, 404)
  try {
    await Promise.race([copyReady, restoring.then(() => { throw new Error('Restore did not reach the content copy') })])
    await cleanupObjectSpace(app.db, dataRoot, space.id)
  } finally { resume(); interception.mockRestore() }
  await restoring
  expect(await record(raceOld.versionId)).toBeUndefined()
  expect((await app.db.selectFrom('space_objects').selectAll().where('id', '=', raceCurrent.id).executeTakeFirst())?.current_version_id).toBe(raceCurrent.versionId)
})
