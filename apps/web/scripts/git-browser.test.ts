import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GetGitSpaceTree200EntriesItem } from '../src/api/generated/api.schemas.ts'
import { getGitSpaceFile } from '../src/api/generated/spaces.ts'
import { defaultGitBranch, gitErrorMessage, gitLocation, sortGitEntries } from '../src/pages/SpacesPage/gitBrowserApi.ts'

test('repository links retain branch, path, and file mode without interpreting special characters', () => {
  const url = new URL(gitLocation('my-account', 'repo', 'feature/docs', 'docs/a #?.md', true), 'https://example.test')
  assert.equal(url.pathname, '/my-account/repo')
  assert.equal(url.searchParams.get('ref'), 'feature/docs')
  assert.equal(url.searchParams.get('path'), 'docs/a #?.md')
  assert.equal(url.searchParams.get('view'), 'file')
  assert.equal(url.hash, '')
  const root = new URL(gitLocation('my-account', 'repo', 'main'), 'https://example.test')
  assert.equal(root.searchParams.has('path'), false)
  assert.equal(root.searchParams.has('view'), false)
})

test('default branch handles unborn HEAD and empty repositories', () => {
  assert.equal(defaultGitBranch({ defaultBranch: 'main', branches: ['dev', 'main'], commits: [] }), 'main')
  assert.equal(defaultGitBranch({ defaultBranch: 'master', branches: ['main'], commits: [] }), 'main')
  assert.equal(defaultGitBranch({ defaultBranch: 'main', branches: [], commits: [] }), '')
})

test('entries are sorted with directories first without changing query data', () => {
  const entries: GetGitSpaceTree200EntriesItem[] = [
    { id: '1', name: 'README.md', path: 'README.md', type: 'file', size: 10 },
    { id: '2', name: 'src', path: 'src', type: 'directory', size: null },
    { id: '3', name: 'docs', path: 'docs', type: 'directory', size: null },
  ]
  assert.deepEqual(sortGitEntries(entries).map(entry => entry.name), ['docs', 'src', 'README.md'])
  assert.equal(entries[0].name, 'README.md')
})

test('file requests preserve explicit branch refs and distinguish size and access errors', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string, options?: RequestInit) => {
    const request = new URL(url, 'https://example.test')
    assert.equal(request.searchParams.get('ref'), 'refs/heads/feature/docs')
    assert.equal(request.searchParams.get('path'), 'docs/a #.txt')
    assert.equal(options?.credentials, 'include')
    return Response.json({ content: 'file content', encoding: 'utf-8' })
  })
  assert.equal((await getGitSpaceFile('owner', 'repo', { ref: 'refs/heads/feature/docs', path: 'docs/a #.txt' })).content, 'file content')
  assert.match(gitErrorMessage({ status: 413 }), /1 MiB/)
  assert.match(gitErrorMessage({ status: 404 }), /no longer exists/)
  assert.match(gitErrorMessage({ status: 403 }), /access/)
})
