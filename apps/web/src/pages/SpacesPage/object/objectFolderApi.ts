import { spacePath } from '../shared/spaceApi.ts'

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
