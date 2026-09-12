import { randomUUID } from 'node:crypto'
import type { Kysely } from 'kysely'
import type { Database } from '../../db/index.js'
import type { ObjectVersionPage, PublicSpaceObject, SpaceObject } from '../../db/object.types.js'
import { createAuditEvent } from '../audit/audit.js'
import { getReadableObjectSpace, getWritableObjectSpace } from '../space/space.js'
import { requireSpaceStorage } from '../space/storage.js'
import { withStorageWrite } from '../space/storage-access.js'
import { deleteObjectFile, writeObjectFile } from './storage.js'
import {
  downloadObject, ensureObjectQuota, escapeLikePrefix, getObjectByKey,
  normalizeContentType, normalizeObjectListLimit, ObjectServiceError, parseContentLength,
  readObjectStorageUsage, throwObjectStorageError, toPublicSpaceObject, validateObjectKey,
  type UploadObjectInput,
} from './object.js'

export async function getObjectHead(
  db: Kysely<Database>, actor: string, namespace: string, slug: string, inputKey: string,
): Promise<PublicSpaceObject | null> {
  const key = validateObjectKey(inputKey)
  const space = await getReadableObjectSpace(db, actor, namespace, slug)
  const object = await findObject(db, space.id, key)
  return object ? toPublicSpaceObject(object) : null
}

export async function listObjectVersions(
  db: Kysely<Database>, actor: string, namespace: string, slug: string,
  input: { key: string; cursor?: number; limit?: number },
): Promise<ObjectVersionPage> {
  const space = await getReadableObjectSpace(db, actor, namespace, slug)
  const object = await getObjectByKey(db, space.id, validateObjectKey(input.key))
  const limit = normalizeObjectListLimit(input.limit ?? 30)
  let query = db.selectFrom('space_object_versions as v')
    .leftJoin('users as u', 'u.id', 'v.created_by_user_id')
    .selectAll('v').select('u.display_name as author_name').where('v.object_id', '=', object.id)
    .where('v.revision', '<=', object.revision)
    .where('v.purge_started_at', 'is', null)
  if (input.cursor !== undefined) query = query.where('v.revision', '<', input.cursor)
  const rows = await query.orderBy('v.revision', 'desc').limit(limit + 1).execute()
  const page = rows.slice(0, limit)
  return {
    object: toPublicSpaceObject(object),
    versionLimit: space.objectVersionLimit,
    retentionDays: space.objectRetentionDays,
    versions: page.map(v => ({
      ...toPublicSpaceObject({ ...object, current_version_id: v.id, revision: v.revision,
        is_deleted: v.is_deleted, content_type: v.content_type, size_bytes: v.size_bytes,
        checksum_sha256: v.checksum_sha256, created_by_user_id: v.created_by_user_id,
        created_at: v.created_at, updated_at: v.created_at }),
      createdByName: v.author_name,
    })),
    nextCursor: rows.length > limit ? page.at(-1)!.revision : null,
  }
}

export function uploadObject(...args: Parameters<typeof uploadObjectMutation>) {
  return withStorageWrite(args[1], () => uploadObjectMutation(...args))
}

async function uploadObjectMutation(
  db: Kysely<Database>, dataRoot: string, actor: string, namespace: string, slug: string,
  input: UploadObjectInput,
  restoredFrom?: { id: string; checksum: string; size: number },
): Promise<PublicSpaceObject> {
  const key = validateObjectKey(input.key)
  const contentType = normalizeContentType(input.contentType)
  const declaredSize = parseContentLength(input.contentLength)
  const space = await getWritableObjectSpace(db, actor, namespace, slug)
  await requireSpaceStorage(dataRoot, space.id, 'object', true)
  const before = await findObject(db, space.id, key)
  const expected = input.expectedVersion ?? before?.current_version_id ?? 'none'
  checkExpected(before, expected)

  // Random single-segment storage names cannot overlap a logical key hierarchy.
  // Exclusive creation also protects any legacy file with a coinciding name.
  const versionId = randomUUID()
  const storageKey = versionId
  let stored
  try { stored = await writeObjectFile(dataRoot, space.id, storageKey, input.source, declaredSize) }
  catch (error) { throwObjectStorageError(error) }

  try {
    if (restoredFrom && (stored.checksumSha256 !== restoredFrom.checksum || stored.sizeBytes !== restoredFrom.size)) {
      throw new ObjectServiceError('OBJECT_CONTENT_CORRUPT', 409, 'Stored version content does not match its checksum. Restore was cancelled.')
    }
    return await db.transaction().execute(async tx => {
      const usage = await readObjectStorageUsage(tx, space.id, true)
      // Recheck access after acquiring the mutation lock.
      await getWritableObjectSpace(tx, actor, namespace, slug)
      await requireSpaceStorage(dataRoot, space.id, 'object', true)
      const current = await findObject(tx, space.id, key)
      checkExpected(current, expected)
      if (restoredFrom) {
        const source = await tx.selectFrom('space_object_versions').select('id')
          .where('object_id', '=', current!.id).where('id', '=', restoredFrom.id)
          .where('purge_started_at', 'is', null).executeTakeFirst()
        if (!source) throw new ObjectServiceError('NOT_FOUND', 404, 'This version is no longer available.')
      }
      await ensureKeyAvailable(tx, space.id, key)
      ensureObjectQuota(usage, stored.sizeBytes)
      if (current) await tx.updateTable('space_object_versions').set({ inactive_at: new Date() })
        .where('id', '=', current.current_version_id).execute()
      const metadata = { content_type: contentType, size_bytes: stored.sizeBytes,
        checksum_sha256: stored.checksumSha256, created_by_user_id: actor,
        current_version_id: versionId, revision: (current?.revision ?? 0) + 1,
        is_deleted: false, updated_at: new Date() }
      const object = current
        ? await tx.updateTable('space_objects').set(metadata).where('id', '=', current.id).returningAll().executeTakeFirstOrThrow()
        : await tx.insertInto('space_objects').values({ ...metadata, key, space_id: space.id }).returningAll().executeTakeFirstOrThrow()
      await tx.insertInto('space_object_versions').values({
        id: versionId, object_id: object.id, space_id: space.id, revision: object.revision,
        storage_key: storageKey, is_deleted: false, content_type: contentType,
        size_bytes: stored.sizeBytes, checksum_sha256: stored.checksumSha256, created_by_user_id: actor,
      }).execute()
      await createAuditEvent(tx, { actorUserId: actor, namespaceId: space.namespaceId, spaceId: space.id,
        action: 'object.uploaded', metadata: { objectId: object.id, key, versionId, revision: object.revision,
          sizeBytes: stored.sizeBytes, checksumSha256: stored.checksumSha256,
          ...(restoredFrom ? { restoredFromVersionId: restoredFrom.id } : {}) } })
      return toPublicSpaceObject(object)
    })
  } catch (error) {
    // A lost COMMIT response is ambiguous. Query before compensating; if the DB
    // cannot confirm absence, preserve the bytes for later reconciliation.
    try {
      const committed = await db.selectFrom('space_object_versions').select('id').where('id', '=', versionId).executeTakeFirst()
      if (!committed) await deleteObjectFile(dataRoot, space.id, storageKey)
    } catch (cleanupError) {
      throw new ObjectServiceError('INTERNAL', 500, 'Could not confirm or clean up the new version.', new AggregateError([error, cleanupError]))
    }
    throw error
  }
}

export function deleteObject(...args: Parameters<typeof deleteObjectMutation>) {
  return withStorageWrite(args[1], () => deleteObjectMutation(...args))
}

async function deleteObjectMutation(
  db: Kysely<Database>, dataRoot: string, actor: string, namespace: string, slug: string,
  inputKey: string, expectedVersion?: string,
): Promise<void> {
  const key = validateObjectKey(inputKey)
  const space = await getWritableObjectSpace(db, actor, namespace, slug)
  const before = await getObjectByKey(db, space.id, key)
  const expected = expectedVersion ?? before.current_version_id
  await requireSpaceStorage(dataRoot, space.id, 'object', true)
  await db.transaction().execute(async tx => {
    await readObjectStorageUsage(tx, space.id, true)
    await getWritableObjectSpace(tx, actor, namespace, slug)
    const current = await getObjectByKey(tx, space.id, key)
    checkExpected(current, expected)
    if (current.is_deleted) return
    const versionId = randomUUID()
    const revision = current.revision + 1
    await tx.updateTable('space_object_versions').set({ inactive_at: new Date() })
      .where('id', '=', current.current_version_id).execute()
    await tx.insertInto('space_object_versions').values({
      id: versionId, object_id: current.id, space_id: space.id, revision, storage_key: null,
      is_deleted: true, content_type: current.content_type, size_bytes: 0,
      checksum_sha256: '0'.repeat(64), created_by_user_id: actor,
    }).execute()
    await tx.updateTable('space_objects').set({ current_version_id: versionId, revision,
      is_deleted: true, updated_at: new Date() }).where('id', '=', current.id).execute()
    await createAuditEvent(tx, { actorUserId: actor, namespaceId: space.namespaceId, spaceId: space.id,
      action: 'object.deleted', metadata: { objectId: current.id, key, versionId, revision } })
  })
}

export function restoreObjectVersion(...args: Parameters<typeof restoreObjectVersionMutation>) {
  return withStorageWrite(args[1], () => restoreObjectVersionMutation(...args))
}

async function restoreObjectVersionMutation(
  db: Kysely<Database>, dataRoot: string, actor: string, namespace: string, slug: string,
  input: { key: string; versionId: string; expectedVersion: string },
): Promise<PublicSpaceObject> {
  // Check write permission before opening any content stream.
  await getWritableObjectSpace(db, actor, namespace, slug)
  const source = await downloadObject(db, dataRoot, actor, namespace, slug, input.key, input.versionId)
  try {
    return await uploadObject(db, dataRoot, actor, namespace, slug, {
      key: input.key, expectedVersion: input.expectedVersion, source: source.stream,
      contentType: source.object.contentType, contentLength: String(source.object.sizeBytes),
    }, { id: input.versionId, checksum: source.object.checksumSha256, size: source.object.sizeBytes })
  } finally { source.stream.destroy() }
}

function findObject(db: Kysely<Database>, spaceId: string, key: string) {
  return db.selectFrom('space_objects').selectAll().where('space_id', '=', spaceId).where('key', '=', key).executeTakeFirst()
}

function checkExpected(object: SpaceObject | undefined, expected: string) {
  if ((object?.current_version_id ?? 'none') !== expected) {
    throw new ObjectServiceError('CONFLICT', 409, 'This file has changed. Refresh before trying again.')
  }
}

async function ensureKeyAvailable(db: Kysely<Database>, spaceId: string, key: string) {
  const ancestors = key.split('/').slice(0, -1).map((_, i) => key.split('/').slice(0, i + 1).join('/'))
  const collision = await db.selectFrom('space_objects').select('id')
    .where('space_id', '=', spaceId).where('is_deleted', '=', false)
    .where(eb => eb.or([
      eb('key', 'like', escapeLikePrefix(key + '/') + '%'),
      ...(ancestors.length ? [eb('key', 'in', ancestors)] : []),
    ])).executeTakeFirst()
  if (collision) throw new ObjectServiceError('CONFLICT', 409, 'This name conflicts with an existing file or folder.')
}
