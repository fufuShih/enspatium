import { expect, test, vi } from 'vitest'
import type { GetGitSpaceTree200EntriesItem } from '../src/api/generated/api.schemas.ts'
import { getGitSpaceFile } from '../src/api/generated/spaces.ts'
import { defaultGitBranch, gitErrorMessage, gitLocation, sortGitEntries } from '../src/pages/SpacesPage/gitBrowserApi.ts'

test('repository links retain branch, path, and file mode without interpreting special characters', () => {
  const url = new URL(gitLocation('my-account', 'repo', 'feature/docs', 'docs/a #?.md', true), 'https://example.test')
  expect(url.pathname).toBe('/my-account/repo')
  expect(url.searchParams.get('ref')).toBe('feature/docs')
  expect(url.searchParams.get('path')).toBe('docs/a #?.md')
  expect(url.searchParams.get('view')).toBe('file')
  expect(url.hash).toBe('')
  const root = new URL(gitLocation('my-account', 'repo', 'main'), 'https://example.test')
  expect(root.searchParams.has('path')).toBe(false)
  expect(root.searchParams.has('view')).toBe(false)
})

test('default branch handles unborn HEAD and empty repositories', () => {
  expect(defaultGitBranch({ defaultBranch: 'main', branches: ['dev', 'main'], commits: [] })).toBe('main')
  expect(defaultGitBranch({ defaultBranch: 'master', branches: ['main'], commits: [] })).toBe('main')
  expect(defaultGitBranch({ defaultBranch: 'main', branches: [], commits: [] })).toBe('')
})

test('entries are sorted with directories first without changing query data', () => {
  const entries: GetGitSpaceTree200EntriesItem[] = [
    { id: '1', name: 'README.md', path: 'README.md', type: 'file', size: 10 },
    { id: '2', name: 'src', path: 'src', type: 'directory', size: null },
    { id: '3', name: 'docs', path: 'docs', type: 'directory', size: null },
  ]
  expect(sortGitEntries(entries).map(entry => entry.name)).toStrictEqual(['docs', 'src', 'README.md'])
  expect(entries[0].name).toBe('README.md')
})

test('file requests preserve explicit branch refs and distinguish size and access errors', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    const request = new URL(String(url), 'https://example.test')
    expect(request.searchParams.get('ref')).toBe('refs/heads/feature/docs')
    expect(request.searchParams.get('path')).toBe('docs/a #.txt')
    expect(options?.credentials).toBe('include')
    return Response.json({ content: 'file content', encoding: 'utf-8' })
  })
  expect((await getGitSpaceFile('owner', 'repo', { ref: 'refs/heads/feature/docs', path: 'docs/a #.txt' })).content).toBe('file content')
  expect(gitErrorMessage({ status: 413 })).toMatch(/1 MiB/)
  expect(gitErrorMessage({ status: 404 })).toMatch(/no longer exists/)
  expect(gitErrorMessage({ status: 403 })).toMatch(/access/)
})
