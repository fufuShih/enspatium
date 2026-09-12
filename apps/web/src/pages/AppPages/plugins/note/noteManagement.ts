import { objectMoveKey } from '../../../SpacesPage/object/objectMoveApi'

export function noteMoveKey(key: string, mode: 'rename' | 'move', value: string) {
  const name = value.trim()
  if (mode === 'move') return objectMoveKey(key, mode, name)
  if (!name) return null
  const extension = /\.(md|markdown)$/i.exec(key)?.[0] ?? '.md'
  return objectMoveKey(key, mode, /\.(md|markdown)$/i.test(name) ? name : name + extension)
}
