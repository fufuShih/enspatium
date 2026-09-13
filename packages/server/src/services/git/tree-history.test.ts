import { expect, test } from 'vitest'
import { parseTreeHistory } from './tree-history.js'

test('history maps changes to immediate children without confusing unusual filenames with records', () => {
  const recent = 'a'.repeat(40), old = 'b'.repeat(40)
  const header = (id: string, message: string) => ['', id, id.slice(0, 7), '2026-09-13T00:00:00Z', message, ''].join('\0')
  const changed = (path: string) => `\n:100644 100644 abc def M\0${path}\0`
  const output = header(recent, 'Update docs') + changed('docs/changed.md') + changed(old)
    + header(old, 'Initial files') + changed('docs/stable.md') + changed('README.md')
  const root = parseTreeHistory(output, '', ['docs', old, 'README.md'])
  expect(root.get('docs')?.id).toBe(recent)
  expect(root.get(old)?.id).toBe(recent)
  expect(root.get('README.md')?.id).toBe(old)
  const docs = parseTreeHistory(output, 'docs', ['changed.md', 'stable.md'])
  expect(docs.get('changed.md')?.id).toBe(recent)
  expect(docs.get('stable.md')?.id).toBe(old)
})
