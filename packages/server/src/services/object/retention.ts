import { sql, type Kysely } from 'kysely'
import type { Database } from '../../db/index.js'
import { createAuditEvent } from '../audit/audit.js'
import { requireSpaceStorage } from '../space/storage.js'
import { StorageBusyError, withStorageWrite } from '../space/storage-access.js'
import { deleteObjectFile } from './storage.js'

const cleanupBatchSize = 100

/** Mark before touching bytes, then delete under the same Space lock as writes.
 * A failed/unconfirmed DB commit leaves a durable purge marker to retry. */
export function cleanupObjectSpace(...args: Parameters<typeof cleanupObjectSpaceMutation>) {
  return withStorageWrite(args[1], () => cleanupObjectSpaceMutation(...args))
}

async function cleanupObjectSpaceMutation(
  db: Kysely<Database>, dataRoot: string, spaceId: string, now = new Date(),
): Promise<number> {
  await db.transaction().execute(async tx => {
    const space = await tx.selectFrom('spaces').selectAll().where('id', '=', spaceId).forUpdate().executeTakeFirst()
    if (!space || space.type !== 'object') return
    await requireSpaceStorage(dataRoot, space.id, 'object', true)
    const cutoff = new Date(now.getTime() - space.object_retention_days * 86_400_000)
    // Count content versions only; deletion markers never evict a content version.
    // Existing purge markers stay irreversible even if settings are later raised.
    await sql`
      with ranked as (
        select v.id, v.inactive_at, v.is_deleted, v.purge_started_at,
          o.current_version_id,
          count(*) filter (where not v.is_deleted and v.purge_started_at is null)
            over (partition by v.object_id order by v.revision desc) as content_rank
        from space_object_versions v join space_objects o on o.id = v.object_id
        where v.space_id = ${spaceId}
      ), expired as (
        select id from ranked where id <> current_version_id and purge_started_at is null
          and (inactive_at <= ${cutoff} or (not is_deleted and content_rank > ${space.object_version_limit}))
        order by inactive_at asc, id limit ${cleanupBatchSize}
      )
      update space_object_versions set purge_started_at = ${now}
      where id in (select id from expired)
    `.execute(tx)
  })

  const pending = await db.selectFrom('space_object_versions').select('id')
    .where('space_id', '=', spaceId).where('purge_started_at', 'is not', null)
    .orderBy('purge_started_at').orderBy('id').limit(cleanupBatchSize).execute()
  let purged = 0
  const failures: unknown[] = []
  for (const candidate of pending) {
    try {
      purged += await db.transaction().execute(async tx => {
        const space = await tx.selectFrom('spaces').selectAll().where('id', '=', spaceId).forUpdate().executeTakeFirst()
        if (!space) return 0
        const version = await tx.selectFrom('space_object_versions').selectAll()
          .where('id', '=', candidate.id).where('space_id', '=', spaceId)
          .where('purge_started_at', 'is not', null).executeTakeFirst()
        if (!version) return 0
        const object = await tx.selectFrom('space_objects').selectAll().where('id', '=', version.object_id).executeTakeFirstOrThrow()
        if (object.current_version_id === version.id) throw new Error('Refusing to purge the current Object version')
        await requireSpaceStorage(dataRoot, spaceId, 'object', true)
        if (version.storage_key) await deleteObjectFile(dataRoot, spaceId, version.storage_key)
        await tx.deleteFrom('space_object_versions').where('id', '=', version.id).execute()
        await createAuditEvent(tx, { actorUserId: null, namespaceId: space.namespace_id, spaceId,
          action: 'object.version_purged', metadata: { objectId: object.id, key: object.key,
            versionId: version.id, revision: version.revision, sizeBytes: version.size_bytes } })
        return 1
      })
    } catch (error) { failures.push(error) }
  }

  // Remove an expired deleted-file shell only once every historical row is gone.
  // The current deletion marker has no content. Active heads are never removed.
  await db.transaction().execute(async tx => {
    const space = await tx.selectFrom('spaces').selectAll().where('id', '=', spaceId).forUpdate().executeTakeFirst()
    if (!space || space.type !== 'object') return
    await requireSpaceStorage(dataRoot, spaceId, 'object', true)
    const cutoff = new Date(now.getTime() - space.object_retention_days * 86_400_000)
    await sql`
      delete from space_objects o where o.space_id = ${spaceId} and o.is_deleted
        and o.updated_at <= ${cutoff}
        and not exists (select 1 from space_object_versions v
          where v.object_id = o.id and v.id <> o.current_version_id)
    `.execute(tx)
  })
  if (failures.length) throw new AggregateError(failures, `Object retention could not purge ${failures.length} versions`)
  return purged
}

export async function cleanupObjectVersions(
  db: Kysely<Database>, dataRoot: string, onError: (error: unknown, spaceId: string) => void,
): Promise<void> {
  let cursor: string | undefined
  for (;;) {
    let query = db.selectFrom('spaces').select('id').where('type', '=', 'object')
    if (cursor) query = query.where('id', '>', cursor)
    const spaces = await query.orderBy('id').limit(100).execute()
    if (!spaces.length) return
    for (const space of spaces) {
      try { await cleanupObjectSpace(db, dataRoot, space.id) }
      catch (error) {
        if (error instanceof StorageBusyError) return // Retry at the next sweep, without interrupting the check.
        onError(error, space.id)
      }
    }
    cursor = spaces.at(-1)!.id
  }
}

/** One sweep at startup, then periodically; never overlaps itself, and shutdown
 * waits for the in-flight sweep before the database pool is closed. */
export function startObjectCleanupLoop(run: () => Promise<void>, onError: (error: unknown) => void, intervalMs: number) {
  let running: Promise<void> | undefined
  let stopped = false
  const tick = () => {
    if (stopped || running) return
    running = Promise.resolve().then(run).catch(onError).finally(() => { running = undefined })
  }
  const timer = setInterval(tick, intervalMs)
  timer.unref()
  tick()
  return async () => { stopped = true; clearInterval(timer); await running }
}
