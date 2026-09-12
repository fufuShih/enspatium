import { expect, test, vi } from 'vitest'
import type { GetGitSpaceTree200EntriesItem } from '../src/api/generated/api.schemas.ts'
import { getGitSpaceFile, getGetGitSpaceRawFileUrl, getGitSpaceRawFile, getDownloadGitSpaceArchiveUrl, downloadGitSpaceArchive } from '../src/api/generated/spaces.ts'
import { defaultGitBranch, gitArchiveRef, gitErrorMessage, gitLocation, sortGitEntries } from '../src/pages/SpacesPage/gitBrowserApi.ts'

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

test('file snapshots and raw URLs preserve commit and path; generated downloads return exact binary bytes', async () => {
  const commit = 'a'.repeat(40)
  const path = 'docs/中文 #%.bin'
  const location = new URL(gitLocation('owner', 'repo', 'feature/docs', path, true, commit), 'https://example.test')
  expect(location.searchParams.get('commit')).toBe(commit)
  expect(new URL(gitLocation('owner', 'repo', 'main', '', false, commit), location).searchParams.has('commit')).toBe(false)
  const url = new URL(getGetGitSpaceRawFileUrl('owner', 'repo', { ref: commit, path, download: true }), location)
  expect(url.pathname).toBe('/api/namespaces/owner/spaces/repo/git/raw')
  expect(url.searchParams.get('path')).toBe(path)
  expect(url.searchParams.get('ref')).toBe(commit)
  expect(url.searchParams.get('download')).toBe('true')
  expect(url.hash).toBe('')
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
    expect(options?.credentials).toBe('include')
    return new Response(new Uint8Array([0, 255, 12]), { headers: { 'content-type': 'application/octet-stream' } })
  })
  const blob = await getGitSpaceRawFile('owner', 'repo', { ref: commit, path, download: true })
  expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0, 255, 12])
})

test('default branch handles unborn HEAD and empty repositories', () => {
  expect(defaultGitBranch({ defaultBranch: 'main', branches: ['dev', 'main'], commits: [] })).toBe('main')
  expect(defaultGitBranch({ defaultBranch: 'master', branches: ['main'], commits: [] })).toBe('main')
  expect(defaultGitBranch({ defaultBranch: 'main', branches: [], commits: [] })).toBe('')
})

test('ZIP links use the visible snapshot and preserve branch names through the generated client', async () => {
  const treeCommit = 'a'.repeat(40)
  const selectedCommit = 'b'.repeat(40)
  expect(gitArchiveRef(new URLSearchParams(), 'main')).toBeUndefined()
  expect(gitArchiveRef(new URLSearchParams(), 'main', treeCommit)).toBe(treeCommit)
  expect(gitArchiveRef(new URLSearchParams({ view: 'file', commit: selectedCommit }), 'main', treeCommit)).toBe(selectedCommit)
  expect(gitArchiveRef(new URLSearchParams({ view: 'commits', snapshot: treeCommit }), 'main')).toBe(treeCommit)
  expect(gitArchiveRef(new URLSearchParams({ view: 'commits', snapshot: treeCommit, commit: selectedCommit }), 'main')).toBe(selectedCommit)
  expect(gitArchiveRef(new URLSearchParams({ view: 'commits' }), 'feature/docs')).toBe('refs/heads/feature/docs')
  const params = { ref: 'refs/heads/feature/a #%' }
  const url = new URL(getDownloadGitSpaceArchiveUrl('owner', 'repo', params), 'https://example.test')
  expect(url.pathname).toBe('/api/namespaces/owner/spaces/repo/git/archive')
  expect(url.searchParams.get('ref')).toBe(params.ref)
  expect(url.hash).toBe('')
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
    expect(options?.credentials).toBe('include')
    return new Response(new Uint8Array([80, 75, 3, 4]), { headers: { 'content-type': 'application/zip' } })
  })
  expect([...new Uint8Array(await (await downloadGitSpaceArchive('owner', 'repo', params)).arrayBuffer())]).toEqual([80, 75, 3, 4])
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
