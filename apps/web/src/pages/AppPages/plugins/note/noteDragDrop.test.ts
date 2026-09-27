import { expect, test } from 'vitest'
import { dragItemContainsKey, noteDropMove } from './noteDragDrop'

test('notes move into folders and back to the top level', () => {
  const note = { kind: 'note', id: 'note-id', key: 'Inbox/Today.md', versionId: 'version-id' } as const
  expect(noteDropMove(note, 'Archive')).toEqual({ kind: 'note', newKey: 'Archive/Today.md' })
  expect(noteDropMove(note, '')).toEqual({ kind: 'note', newKey: 'Today.md' })
  expect(noteDropMove(note, 'Inbox')).toBeNull()
})

test('folders preserve their name and cannot move into themselves', () => {
  const folder = { kind: 'folder', prefix: 'Projects/Ideas/' } as const
  expect(noteDropMove(folder, 'Archive')).toEqual({ kind: 'folder', newPrefix: 'Archive/Ideas/' })
  expect(noteDropMove(folder, '')).toEqual({ kind: 'folder', newPrefix: 'Ideas/' })
  expect(noteDropMove(folder, 'Projects')).toBeNull()
  expect(noteDropMove(folder, 'Projects/Ideas/Child')).toBeNull()
  expect(dragItemContainsKey(folder, 'Projects/Ideas/Draft.md')).toBe(true)
})
