import type { Kysely } from 'kysely'
import type { Database } from '../../db/index.js'
import type { MoveObjectInput, PublicSpaceObject } from '../../db/types/object.types.js'
import { createAuditEvent } from '../audit/audit.js'
import { getWritableObjectSpace } from '../space/space.js'
import { requireSpaceStorage } from '../space/storage.js'
import { withStorageWrite } from '../space/storage-access.js'
import { escapeLikePrefix, ObjectServiceError, readObjectStorageUsage, toPublicSpaceObject, validateObjectKey } from './object.js'

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
