import { apiStatus } from '../../context/session.ts'
import { uploadObject } from '../../api/generated/objects.ts'

export const fileSizeLimit = 100 * 1024 * 1024
export const fileListLimit = 100

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const unit = bytes < 1024 * 1024 ? 1024 : 1024 * 1024
  return `${(bytes / unit).toLocaleString('en-US', { maximumFractionDigits: 1 })} ${unit === 1024 ? 'KiB' : 'MiB'}`
}

export function fileErrorMessage(error: unknown, action: 'upload' | 'download' | 'list' | 'preview') {
  switch (apiStatus(error)) {
    case 400: return action === 'list' ? 'This filename filter is not supported. Try another prefix.' : 'This filename is not supported. Rename the file and try again.'
    case 401: return 'Your session has expired. Please sign in again.'
    case 403: return action === 'upload' ? 'You need write access to upload files.' : 'You do not have permission to access these files.'
    case 404: return 'This file or Space is no longer available. Refresh the list and try again.'
    case 409: return 'A file with this name already exists. Rename your file before uploading.'
    case 413: return 'The file exceeds the 100 MiB limit or the available storage space.'
    default: return `Unable to ${action === 'list' ? 'load files' : `${action} the file`}. Please try again.`
  }
}

export function uploadFile(account: string, slug: string, file: File, signal: AbortSignal) {
  return uploadObject(account, slug, file.name, file, {
    signal,
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  })
}
