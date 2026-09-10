import { apiStatus } from '../../context/session.ts'
import { uploadObject, getObjectHead, getListObjectVersionsQueryKey, getGetObjectHeadQueryKey, getBrowseObjectsQueryKey, getListObjectsQueryKey, getGetObjectStorageUsageQueryKey } from '../../api/generated/objects.ts'
import type { QueryClient } from '@tanstack/react-query'
import { getListMediaQueryKey } from '../../api/generated/objects.ts'
import { storageErrorMessage } from './storageErrors.ts'

export const fileSizeLimit = 100 * 1024 * 1024
export const fileListLimit = 100

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const unit = bytes < 1024 * 1024 ? 1024 : 1024 * 1024
  return `${(bytes / unit).toLocaleString('en-US', { maximumFractionDigits: 1 })} ${unit === 1024 ? 'KiB' : 'MiB'}`
}

export function fileErrorMessage(error: unknown, action: 'upload' | 'download' | 'list' | 'preview' | 'delete' | 'restore') {
  const storageMessage = storageErrorMessage(error)
  if (storageMessage) return storageMessage
  switch (apiStatus(error)) {
    case 400: return action === 'list' ? 'This folder path or filename filter is not supported. Try another name.' : 'This filename is not supported. Rename the file and try again.'
    case 401: return 'Your session has expired. Please sign in again.'
    case 403: return action === 'upload' || action === 'delete' || action === 'restore' ? `You need write access to ${action} files.` : 'You do not have permission to access these files.'
    case 404: return 'This file or Space is no longer available. Refresh the list and try again.'
    case 409: return 'This file has changed, or its name conflicts with a file or folder. Refresh and try again.'
    case 413: return 'The file exceeds the 100 MiB limit or the available storage space.'
    default: return `Unable to ${action === 'list' ? 'load files' : `${action} the file`}. Please try again.`
  }
}

export async function uploadFile(account: string, slug: string, file: File, signal: AbortSignal, prefix = '') {
  const key = prefix + file.name
  const current = await getObjectHead(account, slug, { key }, { signal })
  return uploadObject(account, slug, key, file, { expectedVersion: current?.versionId ?? 'none' }, {
    signal,
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  })
}

export async function refreshObjectLists(client: QueryClient, account: string, slug: string) {
  const keys = [getListMediaQueryKey(account, slug), getBrowseObjectsQueryKey(account, slug), getListObjectsQueryKey(account, slug), getGetObjectStorageUsageQueryKey(account, slug), getListObjectVersionsQueryKey(account, slug), getGetObjectHeadQueryKey(account, slug)]
  await Promise.all(keys.map(queryKey => client.cancelQueries({ queryKey })))
  await Promise.all(keys.map(queryKey => client.invalidateQueries({ queryKey })))
}
