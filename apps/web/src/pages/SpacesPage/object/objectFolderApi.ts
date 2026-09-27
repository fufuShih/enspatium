import { uploadObject } from '../../../api/generated/objects.ts'
import { spacePath } from '../shared/spaceApi.ts'

export const objectFolderMarkerName = '.enspatium-folder'
export const objectFolderContentType = 'application/vnd.enspatium.folder'

export function objectFolderLocation(account: string, slug: string, prefix = '', filter = '', cursor = '', deleted = false) {
  const params = new URLSearchParams()
  if (prefix) params.set('path', prefix)
  if (filter) params.set('filter', filter)
  if (cursor) params.set('cursor', cursor)
  if (deleted) params.set('deleted', 'true')
  return spacePath(account, slug) + (params.size ? `?${params}` : '')
}

export function objectBreadcrumbs(prefix: string) {
  const segments = prefix.split('/').filter(Boolean)
  return segments.map((name, index) => ({ name, prefix: segments.slice(0, index + 1).join('/') + '/' }))
}

export function newObjectFolder(prefix: string, name: string) {
  if (
    !name || name === '.' || name === '..' ||
    Array.from(name).some(character => character.charCodeAt(0) < 32) ||
    /[<>:"/\\|?*]/.test(name) || /[. ]$/.test(name) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ||
    (prefix + name + '/').length >= 1024
  ) return null
  return prefix + name + '/'
}

export function objectFolderPath(input: string) {
  const names = input.trim().replace(/\/$/, '').split('/')
  if (!names.length || names.some(name => !name)) return null
  let prefix = ''
  for (const name of names) {
    const next = newObjectFolder(prefix, name)
    if (!next) return null
    prefix = next
  }
  return prefix
}

export function objectFolderMarkerKey(prefix: string) {
  return prefix + objectFolderMarkerName
}

export async function createObjectFolder(account: string, slug: string, prefix: string) {
  return uploadObject(account, slug, objectFolderMarkerKey(prefix), new Blob([], { type: objectFolderContentType }), { expectedVersion: 'none' }, {
    headers: { 'Content-Type': objectFolderContentType },
  })
}
