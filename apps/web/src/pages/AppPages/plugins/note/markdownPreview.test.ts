import { expect, test } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { previewDecorations, safeNoteLink } from './markdownPreview'
import { noteKey } from './integration'

test('live preview hides inactive markup without changing source and reveals the selected line', () => {
  const doc = '# Title\n\n**Bold** and *italic* with [link](https://example.com)\n\n<custom>[[wiki]]</custom>'
  const make = (anchor: number) => EditorState.create({ doc, selection: { anchor }, extensions: [markdown({ base: markdownLanguage })] })
  const hidden: [number, number][] = []
  const first = make(0)
  previewDecorations(first).between(0, doc.length, (from, to, decoration) => { if (decoration.spec.widget === undefined && !decoration.spec.class && !decoration.spec.tagName && to > from) hidden.push([from, to]) })
  expect(hidden.some(([from, to]) => doc.slice(from, to) === '**')).toBe(true)
  expect(hidden.some(([from]) => from === 0)).toBe(false)
  expect(first.sliceDoc()).toBe(doc)
  const active = make(doc.indexOf('Bold'))
  const markup: string[] = []
  previewDecorations(active).between(0, doc.length, (from, to, decoration) => { if (decoration.spec.class === 'note-syntax') markup.push(doc.slice(from, to)) })
  expect(markup).toContain('**')
  expect(active.sliceDoc()).toBe(doc)
})

test('only safe external link protocols are clickable', () => {
  expect(safeNoteLink('https://example.com/book')).toBe('https://example.com/book')
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'file:///etc/passwd', '/api/logout']) expect(safeNoteLink(url)).toBeUndefined()
})

test('note names preserve nested folders and reject traversal and blank segments', () => {
  expect(noteKey(' Journal/Today ')).toBe('Journal/Today.md')
  expect(noteKey('筆記.MD')).toBe('筆記.MD')
  for (const name of ['', '../secret', 'a/../b', '/a', 'a//b', 'a\\b', 'a/ /b', 'a\nb']) {
    expect(() => noteKey(name)).toThrow()
  }
})
