import { spacePath } from '../shared/spaceApi'
import type { GitRefType } from './gitBrowserApi'

export function parseComparisonRef(ref: string): { name: string; type: GitRefType } | undefined {
  if (ref.startsWith('refs/heads/') && ref.length > 11) return { name: ref.slice(11), type: 'branch' }
  if (ref.startsWith('refs/tags/') && ref.length > 10) return { name: ref.slice(10), type: 'tag' }
}

export type Comparison = { from: string; to: string; base?: string; head?: string; file?: string }

export function comparisonOptions(params: URLSearchParams, fallbackFrom = '', fallbackTo = ''): Comparison {
  const base = params.get('base') || ''
  const head = params.get('head') || ''
  const pinned = /^[0-9a-f]{40,64}$/.test(base) && /^[0-9a-f]{40,64}$/.test(head)
  return { from: params.get('from') || fallbackFrom, to: params.get('to') || fallbackTo, ...(pinned ? { base, head } : {}), file: params.get('file') || undefined }
}

export function gitCompareLocation(account: string, slug: string, options: Comparison) {
  const params = new URLSearchParams({ view: 'compare' })
  if (options.from) params.set('from', options.from)
  if (options.to) params.set('to', options.to)
  if (options.base && options.head) { params.set('base', options.base); params.set('head', options.head) }
  if (options.file) params.set('file', options.file)
  return `${spacePath(account, slug)}?${params}`
}
