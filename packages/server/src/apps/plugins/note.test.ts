import { expect, test } from 'vitest'
import { classifyAppObject } from '../../services/app-objects.js'
import { notePlugin } from './note.js'
import { ebookPlugin } from './ebook.js'

test('Note accepts Markdown and filename fallback without admitting unrelated text or HTML', () => {
  for (const [key, mime] of [['draft.md', 'text/markdown; charset=utf-8'], ['folder/筆記.MD', 'text/plain'], ['draft.markdown', 'application/octet-stream']]) {
    expect(classifyAppObject(notePlugin, key!, mime!)?.kind).toBe('markdown')
  }
  for (const [key, mime] of [['draft.txt', 'text/plain'], ['draft.md', 'text/html'], ['draft.pdf', 'application/pdf']]) {
    expect(classifyAppObject(notePlugin, key!, mime!)).toBeUndefined()
  }
  expect(classifyAppObject(ebookPlugin, 'book.pdf', 'text/plain')).toBeUndefined()
  expect(classifyAppObject(ebookPlugin, 'book.pdf', 'application/octet-stream')?.kind).toBe('pdf')
})
