import { describe, expect, it } from 'vitest'
import { comparisonOptions, gitCompareLocation, parseComparisonRef } from '../src/pages/SpacesPage/git/gitCompareApi'

describe('comparison routes', () => {
  it('preserves distinct namespaces, Unicode paths and both snapshots on reload', () => {
    const options = { from: 'refs/tags/release/首版', to: 'refs/heads/release/首版', base: 'a'.repeat(40), head: 'b'.repeat(40), file: '中文 #%.txt' }
    const url = new URL(gitCompareLocation('owner', 'repo', options), 'https://example.test')
    expect(comparisonOptions(url.searchParams)).toEqual(options)
    expect(parseComparisonRef(options.from)).toEqual({ name: 'release/首版', type: 'tag' })
    expect(parseComparisonRef(options.to)).toEqual({ name: 'release/首版', type: 'branch' })
  })
  it('rejects partial snapshot pairs and unsupported ref namespaces', () => {
    expect(comparisonOptions(new URLSearchParams({ base: 'a'.repeat(40), head: 'bad' }), 'refs/heads/main', 'refs/tags/v1')).toEqual({ from: 'refs/heads/main', to: 'refs/tags/v1', file: undefined })
    expect(parseComparisonRef('refs/replace/abc')).toBeUndefined()
    expect(parseComparisonRef('refs/tags/')).toBeUndefined()
  })
})
