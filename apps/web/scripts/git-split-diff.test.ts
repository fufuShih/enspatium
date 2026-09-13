import { expect, test } from 'vitest'
import { parseGitPatch } from '../src/pages/SpacesPage/git/gitHistoryApi'
import { splitDiffLines } from '../src/pages/SpacesPage/git/splitDiff'

const split = (patch: string) => splitDiffLines(parseGitPatch('diff --git a/a.txt b/a.txt\n' + patch)[0].lines)

test('pairs changed lines with independent line numbers and empty cells for unequal blocks', () => {
  const rows = split('@@ -1,4 +1,3 @@\n same\n-one\n-two\n+replacement\n tail\n')
  expect(rows[1]).toMatchObject({ before: { oldLine: 1 }, after: { newLine: 1 } })
  expect(rows[2]).toMatchObject({ before: { text: '-one', oldLine: 2 }, after: { text: '+replacement', newLine: 2 } })
  expect(rows[3]).toMatchObject({ before: { text: '-two', oldLine: 3 }, after: undefined })
  expect(rows[4]).toMatchObject({ before: { oldLine: 4 }, after: { newLine: 3 } })
})

test('keeps addition-only, deletion-only and separate hunks on their own side', () => {
  const rows = split('@@ -0,0 +1 @@\n+new\n@@ -9 +10,0 @@\n-old\n')
  expect(rows[1]).toMatchObject({ before: undefined, after: { text: '+new', newLine: 1 } })
  expect(rows[3]).toMatchObject({ before: { text: '-old', oldLine: 9 }, after: undefined })
})

test('missing-newline notices stay on the affected side without breaking alignment', () => {
  const rows = split('@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n')
  expect(rows).toHaveLength(2)
  expect(rows[1]).toMatchObject({ before: { text: '-old', noNewline: true }, after: { text: '+new', noNewline: true } })
})
