import { expect, test, vi } from 'vitest'
import { getGitSpaceDiff, listGitSpaceCommits } from '../src/api/generated/spaces.ts'
import { decodeGitPath, gitHistoryLocation, historyOptions, parseGitPatch } from '../src/pages/SpacesPage/git/gitHistoryApi.ts'

test('history links preserve the snapshot, page, branch and selected file across reloads', () => {
  const options = { commit: 'a'.repeat(40), snapshot: 'b'.repeat(40), offset: 30, file: 'docs/a #?.md' }
  const url = new URL(gitHistoryLocation('my team', 'repo', 'feature/docs', options), 'https://example.test')
  expect(url.pathname).toBe('/my%20team/repo')
  expect(url.searchParams.get('view')).toBe('commits')
  expect(url.searchParams.get('ref')).toBe('feature/docs')
  expect(historyOptions(url.searchParams)).toStrictEqual(options)
  expect(historyOptions(new URLSearchParams('offset=-1&snapshot=main')).offset).toBe(0)
  expect(historyOptions(new URLSearchParams('offset=NaN&snapshot=main')).snapshot).toBeUndefined()
})

test('patches retain line numbers, header-like content and missing-newline markers', () => {
  const [file] = parseGitPatch('diff --git a/demo.txt b/demo.txt\nindex abc..def 100644\n--- a/demo.txt\n+++ b/demo.txt\n@@ -2,2 +2,3 @@\n context\n---old\n+++new\n+<script>alert(1)</script>\n\\ No newline at end of file\n@@ -9 +10 @@\n-last\n+next\n')
  expect(file).toMatchObject({ path: 'demo.txt', status: 'Modified', additions: 3, deletions: 2 })
  expect(file.lines[2]).toStrictEqual({ kind: 'removed', text: '---old', oldLine: 3 })
  expect(file.lines[3]).toStrictEqual({ kind: 'added', text: '+++new', newLine: 3 })
  expect(file.lines.at(-1)).toStrictEqual({ kind: 'added', text: '+next', newLine: 10 })
  expect(file.lines[5].kind).toBe('meta')
})

test('filenames decode Git octal UTF-8 and escaped control characters', () => {
  expect(decodeGitPath('"a/\\344\\270\\255\\346\\226\\207.txt"')).toBe('a/中文.txt')
  expect(decodeGitPath('"a/tab\\tquote\\"slash\\\\.txt"')).toBe('a/tab\tquote"slash\\.txt')
  expect(decodeGitPath('a/with spaces.txt\t')).toBe('a/with spaces.txt')
})

test('initial, deleted, renamed, binary and mode-only files remain selectable', () => {
  const files = parseGitPatch([
    'diff --git "a/\\344\\270\\255.txt" "b/\\344\\270\\255.txt"', 'new file mode 100644', '--- /dev/null', '+++ "b/\\344\\270\\255.txt"', '@@ -0,0 +1 @@', '+hello',
    'diff --git a/old name b/old name', 'deleted file mode 100644', '--- a/old name\t', '+++ /dev/null', '@@ -1 +0,0 @@', '-old',
    'diff --git a/from name b/to name', 'similarity index 100%', 'rename from from name', 'rename to to name',
    'diff --git a/a b/image.bin b/a b/image.bin', 'index abc..def 100644', 'Binary files a/a b/image.bin and b/a b/image.bin differ',
    'diff --git a/run.sh b/run.sh', 'old mode 100644', 'new mode 100755', '',
  ].join('\n'))
  expect(files.map(({ path, status }) => ({ path, status }))).toStrictEqual([
    { path: '中.txt', status: 'Added' }, { path: 'old name', status: 'Deleted' },
    { path: 'to name', status: 'Renamed' }, { path: 'a b/image.bin', status: 'Modified' }, { path: 'run.sh', status: 'Modified' },
  ])
  expect(files[0].lines.at(-1)?.newLine).toBe(1)
  expect(files[1].lines.at(-1)?.oldLine).toBe(1)
  expect(files[2].oldPath).toBe('from name')
  expect(files[3].binary).toBe(true)
  expect(files[4].lines.map(line => line.text)).toEqual(['old mode 100644', 'new mode 100755'])
  expect(parseGitPatch('')).toEqual([])
})

test('generated history and initial diff requests preserve typed parameters and session credentials', async () => {
  const requests: URL[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    requests.push(new URL(String(url), 'https://example.test'))
    expect(options?.credentials).toBe('include')
    return Response.json({})
  })
  await listGitSpaceCommits('owner', 'repo', { ref: 'refs/heads/feature/docs', offset: 30, limit: 30 })
  await getGitSpaceDiff('owner', 'repo', { to: 'a'.repeat(40) })
  expect(requests[0].searchParams.get('ref')).toBe('refs/heads/feature/docs')
  expect(requests[0].searchParams.get('offset')).toBe('30')
  expect(requests[1].searchParams.has('from')).toBe(false)
})
