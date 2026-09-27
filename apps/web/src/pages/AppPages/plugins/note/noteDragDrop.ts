import { objectParent } from '../../../SpacesPage/object/objectMoveApi'

export type NoteDragItem =
  | { kind: 'note'; id: string; key: string; versionId: string }
  | { kind: 'folder'; prefix: string }

export type NoteDropMove =
  | { kind: 'note'; newKey: string }
  | { kind: 'folder'; newPrefix: string }

export function noteDropMove(item: NoteDragItem, destination: string): NoteDropMove | null {
  const destinationPrefix = destination ? destination.replace(/\/$/, '') + '/' : ''
  if (item.kind === 'note') {
    const newKey = destinationPrefix + item.key.split('/').at(-1)!
    return objectParent(item.key) === destinationPrefix ? null : { kind: 'note', newKey }
  }
  const prefix = item.prefix.endsWith('/') ? item.prefix : item.prefix + '/'
  const name = prefix.slice(0, -1).split('/').at(-1)!
  const newPrefix = destinationPrefix + name + '/'
  if (newPrefix === prefix || destinationPrefix.startsWith(prefix)) return null
  return { kind: 'folder', newPrefix }
}

export function dragItemContainsKey(item: NoteDragItem, key: string) {
  return item.kind === 'note' ? item.key === key : key.startsWith(item.prefix)
}
