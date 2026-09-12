import { deleteObject, getObjectHead } from '../../api/generated/objects.ts'
import type { ListObjects200Item } from '../../api/generated/api.schemas.ts'

export type DeleteTarget = Pick<ListObjects200Item, 'id' | 'key' | 'versionId'>
export type DeleteItem = DeleteTarget & {
  status: 'queued' | 'deleting' | 'deleted' | 'failed' | 'stopped'
  message?: string
  retryable: boolean
}

export async function deleteSelectedObject(account: string, slug: string, target: DeleteTarget, signal: AbortSignal) {
  const current = await getObjectHead(account, slug, { key: target.key }, { signal })
  signal.throwIfAborted()
  // A lost response can hide a successful delete. A retry must never delete a
  // replacement or restored version, or create another deletion marker.
  if (!current || current.id !== target.id) {
    throw Object.assign(new Error('This file is no longer available. Refresh the list.'), { status: 404 })
  }
  if (current.isDeleted) return 'Already in Deleted files.'
  if (current.versionId !== target.versionId) {
    throw Object.assign(new Error('The selected version changed.'), { status: 409, info: { code: 'DELETE_VERSION_CHANGED' } })
  }
  await deleteObject(account, slug, target.key, { expectedVersion: target.versionId }, { signal })
  return undefined
}
