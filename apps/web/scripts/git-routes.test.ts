import { expect, test } from 'vitest'
import { gitRouteLocation, parseGitRoute } from '../src/pages/SpacesPage/git/gitRoutes'

test('Git path identities round-trip encoded slash and literal percent names without query strings', () => {
  const hash = 'a'.repeat(40), other = 'b'.repeat(40)
  const cases: Record<string, string>[] = [
    { ref: 'feature/docs', path: 'docs/a #%.md', view: 'file', commit: hash },
    { refType: 'tag', ref: 'release/初版', path: 'docs/subdir' },
    { ref: 'literal%2Fname', path: 'docs/%2F.md', view: 'file' },
    { view: 'commits', commit: hash, file: 'docs/changes #%.md' },
    { view: 'commits', ref: 'feature/docs', snapshot: hash },
    { view: 'compare', from: 'refs/heads/a/b', to: 'refs/tags/a/b', base: hash, head: other, file: 'diff/中文.txt' },
  ]
  for (const value of cases) {
    const params = new URLSearchParams(value)
    const url = new URL(gitRouteLocation('owner', 'repo', params), 'https://example.com')
    expect(url.search).toBe('')
    const result = parseGitRoute(url.pathname)
    expect(result.valid).toBe(true)
    for (const [key, expected] of params) expect(result.params.get(key), key).toBe(expected)
  }
})

test('legacy redirects are explicit and path identities cannot be overridden by search', () => {
  for (const [path, target] of [['branches', '/owner/repo'], ['tags', '/owner/repo/tag']]) {
    const result = parseGitRoute('/owner/repo/' + path, '?search=old&offset=30')
    expect(result.legacy).toBe(true)
    expect(gitRouteLocation('owner', 'repo', result.params)).toBe(target)
  }
  expect(gitRouteLocation('owner', 'repo', new URLSearchParams('view=refs&refType=tag'))).toBe('/owner/repo/tag')
  expect(parseGitRoute('/owner/repo', '?view=file&ref=main&path=README.md').legacy).toBe(true)
  expect(parseGitRoute('/owner/repo/branch/main', '?ref=other&view=commits').params.get('ref')).toBe('main')
  expect(parseGitRoute('/owner/repo/branch/main', '?ref=other&view=commits').params.has('view')).toBe(false)
  for (const path of ['unknown', 'branches/extra', 'commit', 'branch', 'branch/main/unknown', 'branch/main/file', 'branch/main/at/hash', 'branch/%ZZ']) expect(parseGitRoute('/owner/repo/' + path).valid, path).toBe(false)
})
