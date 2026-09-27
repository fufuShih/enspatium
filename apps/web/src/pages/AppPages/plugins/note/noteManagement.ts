import { objectMoveKey } from '../../../SpacesPage/object/objectMoveApi'
import type { ListAppInstanceObjects200ObjectsItem } from '../../../../api/generated/api.schemas'

export function noteMoveKey(key: string, mode: 'rename' | 'move', value: string) {
  const name = value.trim()
  if (mode === 'move') return objectMoveKey(key, mode, name)
  if (!name) return null
  const extension = /\.(md|markdown)$/i.exec(key)?.[0] ?? '.md'
  return objectMoveKey(key, mode, /\.(md|markdown)$/i.test(name) ? name : name + extension)
}

export function noteFolders(items: ListAppInstanceObjects200ObjectsItem[]) {
  const folders = new Set<string>()
  for (const item of items) {
    const parts = item.key.split('/').slice(0, -1)
    for (let index = 1; index <= parts.length; index += 1) folders.add(parts.slice(0, index).join('/'))
  }
  return [...folders].sort((left, right) => left.localeCompare(right))
}
