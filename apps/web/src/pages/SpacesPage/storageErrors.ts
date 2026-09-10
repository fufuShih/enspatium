import { apiCode } from '../../context/session.ts'

export function storageErrorMessage(error: unknown) {
  if (apiCode(error) === 'OBJECT_CONTENT_CORRUPT') return 'This version no longer matches its saved checksum. Restore was cancelled and your current version was kept.'
  if (apiCode(error) === 'SPACE_STORAGE_UNAVAILABLE') return 'The storage for this Space is missing or unavailable. Restore storage access, then try again. Your Space records have been kept.'
  if (apiCode(error) === 'OBJECT_CONTENT_MISSING') return 'The file record still exists, but its stored content is missing. Restore the file, then try again. Other files are still available.'
}

export function storageErrorTitle(error: unknown, fallback: string) {
  if (apiCode(error) === 'OBJECT_CONTENT_CORRUPT') return 'File content damaged'
  if (apiCode(error) === 'SPACE_STORAGE_UNAVAILABLE') return 'Storage unavailable'
  if (apiCode(error) === 'OBJECT_CONTENT_MISSING') return 'File content missing'
  return fallback
}
