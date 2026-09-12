import { newObjectFolder } from './objectFolderApi.ts'

export function objectParent(key: string) { return key.slice(0, key.lastIndexOf('/') + 1) }

export function objectMoveKey(key: string, mode: 'rename' | 'move', value: string): string | null {
  if (value.startsWith('/')) return null
  const folder = value.endsWith('/') ? value.slice(0, -1) : value
  const target = mode === 'rename' ? objectParent(key) + value : (folder ? folder + '/' : '') + key.slice(key.lastIndexOf('/') + 1)
  if (mode === 'rename' && value.includes('/')) return null
  if (target.length > 1024 || target.split('/').some(segment => !newObjectFolder('', segment))) return null
  return target
}
