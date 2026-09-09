import { apiStatus } from '../../context/session.ts'
import { uploadObject, getBrowseObjectsQueryKey, getListObjectsQueryKey, getGetObjectStorageUsageQueryKey } from '../../api/generated/objects.ts'
import type { QueryClient } from '@tanstack/react-query'
import { storageErrorMessage } from './storageErrors.ts'

export const fileSizeLimit = 100 * 1024 * 1024
export const fileListLimit = 100

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const unit = bytes < 1024 * 1024 ? 1024 : 1024 * 1024
  return `${(bytes / unit).toLocaleString('en-US', { maximumFractionDigits: 1 })} ${unit === 1024 ? 'KiB' : 'MiB'}`
}

export function fileErrorMessage(error: unknown, action: 'upload' | 'download' | 'list' | 'preview' | 'delete') {
  const storageMessage = storageErrorMessage(error)
  if (storageMessage) return storageMessage
  switch (apiStatus(error)) {
    case 400: return action === 'list' ? 'This folder path or filename filter is not supported. Try another name.' : 'This filename is not supported. Rename the file and try again.'
    case 401: return 'Your session has expired. Please sign in again.'
    case 403: return action === 'upload' || action === 'delete' ? `You need write access to ${action} files.` : 'You do not have permission to access these files.'
    case 404: return 'This file or Space is no longer available. Refresh the list and try again.'
    case 409: return 'A file or folder with this name already exists. Rename your file before uploading.'
    case 413: return 'The file exceeds the 100 MiB limit or the available storage space.'
    default: return `Unable to ${action === 'list' ? 'load files' : `${action} the file`}. Please try again.`
  }
}

export function uploadFile(account: string, slug: string, file: File, signal: AbortSignal, prefix = '') {
  return uploadObject(account, slug, prefix + file.name, file, {
    signal,
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  })
}

export async function refreshObjectLists(client: QueryClient, account: string, slug: string) {
  const keys = [getBrowseObjectsQueryKey(account, slug), getListObjectsQueryKey(account, slug), getGetObjectStorageUsageQueryKey(account, slug)]
  await Promise.all(keys.map(queryKey => client.cancelQueries({ queryKey })))
  await Promise.all(keys.map(queryKey => client.invalidateQueries({ queryKey })))
}
