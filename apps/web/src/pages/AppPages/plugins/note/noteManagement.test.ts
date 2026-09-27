import { expect, test } from 'vitest'
import { noteFolderRenamePrefix, noteFolders, noteMoveKey } from './noteManagement'

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

test('folder options include explicit empty folders and note parents', () => {
  const item = (key: string, kind: string) => ({ key, kind }) as never
  expect(noteFolders([
    item('Projects/.enspatium-folder', 'folder'),
    item('Journal/2026/Today.md', 'markdown'),
  ])).toEqual(['Journal', 'Journal/2026', 'Projects'])
})

test('renaming folders keeps their parent and validates a single name', () => {
  expect(noteFolderRenamePrefix('Journal/Ideas/', 'Archive')).toBe('Journal/Archive/')
  expect(noteFolderRenamePrefix('Journal/', 'Archive')).toBe('Archive/')
  for (const value of ['', '../outside', 'folder/name', 'bad:name', 'CON']) {
    expect(noteFolderRenamePrefix('Journal/', value)).toBeNull()
  }
})
