import { expect, test } from 'vitest'
import { noteMoveKey } from './noteManagement'

test('renaming notes keeps their folder and Markdown extension', () => {
  expect(noteMoveKey('Journal/Today.md', 'rename', 'Tomorrow')).toBe('Journal/Tomorrow.md')
  expect(noteMoveKey('Journal/Today.markdown', 'rename', 'Tomorrow')).toBe('Journal/Tomorrow.markdown')
  expect(noteMoveKey('Today.md', 'rename', 'Thoughts.MD')).toBe('Thoughts.MD')
  for (const value of ['', '../outside', 'folder/note', 'bad:name', 'CON']) expect(noteMoveKey('Today.md', 'rename', value)).toBeNull()
})

test('moving notes supports nested destinations and the root without changing the filename', () => {
  expect(noteMoveKey('Journal/Today.md', 'move', 'Archive/2026/')).toBe('Archive/2026/Today.md')
  expect(noteMoveKey('Journal/Today.md', 'move', '')).toBe('Today.md')
  for (const value of ['/absolute', '../outside', 'folder//other', 'folder\\other']) expect(noteMoveKey('Today.md', 'move', value)).toBeNull()
})
