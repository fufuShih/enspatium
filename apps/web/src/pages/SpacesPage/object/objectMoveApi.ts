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

export type MoveTarget = { id: string; key: string; versionId: string }
export type MoveItem = MoveTarget & {
  newKey: string
  status: 'queued' | 'moving' | 'moved' | 'failed' | 'stopped'
  retryable: boolean
  message?: string
}

export function planObjectMoves(targets: MoveTarget[], folder: string): MoveItem[] | null {
  if (!targets.length) return null
  const items: MoveItem[] = []
  for (const { id, key, versionId } of targets) {
    const newKey = objectMoveKey(key, 'move', folder)
    if (!newKey || newKey === key || items.some(item => item.newKey === newKey)) return null
    items.push({ id, key, versionId, newKey, status: 'queued', retryable: true })
  }
  return items
}
