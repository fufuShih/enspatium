import { sql, type Kysely } from 'kysely'
import type { Database } from '../../db/index.js'
import type { MoveObjectInput, PublicSpaceObject } from '../../db/types/object.types.js'
import { createAuditEvent } from '../audit/audit.js'
import { getWritableObjectSpace } from '../space/space.js'
import { requireSpaceStorage } from '../space/storage.js'
import { withStorageWrite } from '../space/storage-access.js'
import { escapeLikePrefix, ObjectServiceError, readObjectStorageUsage, toPublicSpaceObject, validateObjectKey, validateObjectPrefix } from './object.js'

export function moveObject(db: Kysely<Database>, dataRoot: string, actor: string, namespace: string, slug: string, input: MoveObjectInput): Promise<PublicSpaceObject> {
  return withStorageWrite(dataRoot, async () => {
    const key = validateObjectKey(input.key)
    const newKey = validateObjectKey(input.newKey)
    const space = await getWritableObjectSpace(db, actor, namespace, slug)
    await requireSpaceStorage(dataRoot, space.id, 'object', true)
    return db.transaction().execute(async tx => {
      // Share the Space row lock with uploads, deletion, restore and retention.
      await readObjectStorageUsage(tx, space.id, true)
      await getWritableObjectSpace(tx, actor, namespace, slug)
      await requireSpaceStorage(dataRoot, space.id, 'object', true)
      const object = await tx.selectFrom('space_objects').selectAll()
        .where('space_id', '=', space.id).where('id', '=', input.objectId).executeTakeFirst()
      if (!object) throw new ObjectServiceError('NOT_FOUND', 404, 'This file is no longer available.')
      if (object.is_deleted || object.current_version_id !== input.expectedVersion || (object.key !== key && object.key !== newKey)) {
        throw new ObjectServiceError('OBJECT_MOVE_CONFLICT', 409, 'This file changed or moved. Refresh and review it before trying again.')
      }
      // An identical retry after a lost response is a no-op, including its audit.
      if (object.key === newKey) return toPublicSpaceObject(object)
      const segments = newKey.split('/')
      const ancestors = segments.slice(0, -1).map((_, i) => segments.slice(0, i + 1).join('/'))
      const collision = await tx.selectFrom('space_objects').select('id')
        .where('space_id', '=', space.id).where('id', '!=', object.id)
        .where(eb => eb.or([
          // Deleted objects reserve their exact key and retain their history.
          eb('key', '=', newKey),
          eb.and([eb('is_deleted', '=', false), eb.or([
            eb('key', 'like', escapeLikePrefix(newKey + '/') + '%'),
            ...(ancestors.length ? [eb('key', 'in', ancestors)] : []),
          ])]),
        ])).executeTakeFirst()
      if (collision) throw new ObjectServiceError('OBJECT_KEY_CONFLICT', 409, 'This name is already used by a file, folder or deleted file.')
      // Version storage_key values (including legacy paths) remain untouched.
      const moved = await tx.updateTable('space_objects').set({ key: newKey, updated_at: new Date() })
        .where('id', '=', object.id).returningAll().executeTakeFirstOrThrow()
      await createAuditEvent(tx, { actorUserId: actor, namespaceId: space.namespaceId, spaceId: space.id,
        action: 'object.moved', metadata: { objectId: object.id, oldKey: key, newKey, versionId: object.current_version_id } })
      return toPublicSpaceObject(moved)
    })
  })
}

export function moveObjectFolder(
  db: Kysely<Database>, dataRoot: string, actor: string, namespace: string, slug: string,
  input: { prefix: string; newPrefix: string },
): Promise<{ prefix: string; newPrefix: string; movedCount: number }> {
  return withStorageWrite(dataRoot, async () => {
    const prefix = validateObjectPrefix(input.prefix)
    const newPrefix = validateObjectPrefix(input.newPrefix)
    if (!prefix.endsWith('/') || !newPrefix.endsWith('/')) {
      throw new ObjectServiceError('INVALID_INPUT', 400, 'Folder paths must end with a slash.')
    }
    if (prefix !== newPrefix && (prefix.startsWith(newPrefix) || newPrefix.startsWith(prefix))) {
      throw new ObjectServiceError('INVALID_INPUT', 400, 'A folder cannot be moved into itself or an overlapping path.')
    }
    const space = await getWritableObjectSpace(db, actor, namespace, slug)
    await requireSpaceStorage(dataRoot, space.id, 'object', true)
    return db.transaction().execute(async tx => {
      await readObjectStorageUsage(tx, space.id, true)
      await getWritableObjectSpace(tx, actor, namespace, slug)
      await requireSpaceStorage(dataRoot, space.id, 'object', true)
      const moving = await tx.selectFrom('space_objects').select(['id', 'key'])
        .where('space_id', '=', space.id).where('is_deleted', '=', false)
        .where('key', 'like', escapeLikePrefix(prefix) + '%').forUpdate().execute()
      if (!moving.length) throw new ObjectServiceError('NOT_FOUND', 404, 'This folder is no longer available.')
      if (prefix === newPrefix) return { prefix, newPrefix, movedCount: 0 }
      for (const object of moving) validateObjectKey(newPrefix + object.key.slice(prefix.length))

      const destination = await tx.selectFrom('space_objects').select('id')
        .where('space_id', '=', space.id).where('is_deleted', '=', false)
        .where('key', 'like', escapeLikePrefix(newPrefix) + '%').executeTakeFirst()
      const parts = newPrefix.slice(0, -1).split('/')
      const ancestors = parts.map((_, index) => parts.slice(0, index + 1).join('/'))
      const blockingAncestor = await tx.selectFrom('space_objects').select('id')
        .where('space_id', '=', space.id).where('is_deleted', '=', false)
        .where('key', 'in', ancestors).executeTakeFirst()
      const deletedCollision = await sql<{ found: boolean }>`select exists (
        select 1 from space_objects source
        inner join space_objects target on target.space_id = source.space_id
          and target.is_deleted
          and target.key = ${newPrefix} || substr(source.key, char_length(${prefix}) + 1)
        where source.space_id = ${space.id} and not source.is_deleted
          and source.key like ${escapeLikePrefix(prefix) + '%'}
      ) as found`.execute(tx)
      if (destination || blockingAncestor || deletedCollision.rows[0]?.found) {
        throw new ObjectServiceError('OBJECT_KEY_CONFLICT', 409, 'This folder destination is already in use.')
      }

      const movedAt = new Date()
      const moved = await tx.updateTable('space_objects').set({
        key: sql<string>`${newPrefix} || substr(key, char_length(${prefix}) + 1)`,
        updated_at: movedAt,
      }).where('space_id', '=', space.id).where('is_deleted', '=', false)
        .where('key', 'like', escapeLikePrefix(prefix) + '%').executeTakeFirst()
      const movedCount = Number(moved.numUpdatedRows)
      await createAuditEvent(tx, { actorUserId: actor, namespaceId: space.namespaceId, spaceId: space.id,
        action: 'object.moved', metadata: { oldPrefix: prefix, newPrefix, movedCount, kind: 'folder' } })
      return { prefix, newPrefix, movedCount }
    })
  })
}
