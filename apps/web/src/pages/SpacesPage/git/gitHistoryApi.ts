import { apiStatus } from '../../../context/session.ts'
import { gitErrorMessage, gitLocation } from './gitBrowserApi.ts'

export const commitPageSize = 30
export const maxDiffPreviewLines = 3000

export type HistoryLocation = { commit?: string; offset?: number; snapshot?: string; file?: string }

export function gitHistoryLocation(account: string, slug: string, branch: string, options: HistoryLocation = {}) {
  const [pathname, search] = gitLocation(account, slug, branch).split('?')
  const params = new URLSearchParams(search)
  params.set('view', 'commits')
  if (options.commit) params.set('commit', options.commit)
  if (options.offset) params.set('offset', String(options.offset))
  if (options.snapshot) params.set('snapshot', options.snapshot)
  if (options.file) params.set('file', options.file)
  return `${pathname}?${params}`
}

export function historyOptions(params: URLSearchParams): HistoryLocation {
  const offset = Number(params.get('offset'))
  const snapshot = params.get('snapshot') || undefined
  return {
    commit: params.get('commit') || undefined,
    file: params.get('file') || undefined,
    offset: Number.isSafeInteger(offset) && offset >= 0 && offset <= 1_000_000 ? offset : 0,
    snapshot: snapshot && /^[0-9a-f]{40,64}$/.test(snapshot) ? snapshot : undefined,
  }
}

export function gitHistoryError(error: unknown) {
  if (apiStatus(error) === 404) return 'This commit or branch is no longer available.'
  if (apiStatus(error) === 413) return 'This diff exceeds the 1 MiB preview limit. Clone the repository to view the full changes.'
  return gitErrorMessage(error)
}

export interface DiffLine {
  kind: 'added' | 'removed' | 'context' | 'meta'
  text: string
  oldLine?: number
  newLine?: number
}

export interface DiffFile {
  path: string
  oldPath: string
  status: 'Added' | 'Deleted' | 'Modified' | 'Renamed'
  binary: boolean
  additions: number
  deletions: number
  lines: DiffLine[]
}

// Git quotes unusual filenames using C escapes, including octal UTF-8 bytes.
export function decodeGitPath(value: string): string {
  if (!value.startsWith('"')) return value.replace(/\t$/, '')
  const bytes: number[] = []
  const body = value.slice(1, value.lastIndexOf('"'))
  const escapes: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 }
  for (let index = 0; index < body.length; index++) {
    if (body[index] === '\\') {
      const octal = /^[0-7]{1,3}/.exec(body.slice(index + 1))?.[0]
      if (octal) { bytes.push(Number.parseInt(octal, 8)); index += octal.length }
      else { index++; bytes.push(escapes[body[index]] ?? body.charCodeAt(index)) }
    } else {
      const character = String.fromCodePoint(body.codePointAt(index)!)
      bytes.push(...new TextEncoder().encode(character))
      index += character.length - 1
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

export function parseGitPatch(patch: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | undefined
  let inHunk = false
  let oldLine = 0
  let newLine = 0
  const lines = patch.split('\n')
  if (lines.at(-1) === '') lines.pop()
  for (const text of lines) {
    if (text.startsWith('diff --git ')) {
      const header = text.slice(11)
      const quoted = /^("(?:\\.|[^"])*") ("(?:\\.|[^"])*")$/.exec(header)
      const same = /^a\/(.+) b\/\1$/.exec(header)
      const path = quoted ? decodeGitPath(quoted[2]).slice(2) : same?.[1] ?? header
      file = { path, oldPath: quoted ? decodeGitPath(quoted[1]).slice(2) : path, status: 'Modified', binary: false, additions: 0, deletions: 0, lines: [] }
      files.push(file)
      inHunk = false
      continue
    }
    if (!file) continue
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text)
    if (hunk) {
      oldLine = Number(hunk[1]); newLine = Number(hunk[2]); inHunk = true
      file.lines.push({ kind: 'meta', text })
    } else if (inHunk) {
      if (text.startsWith('+')) { file.additions++; file.lines.push({ kind: 'added', text, newLine: newLine++ }) }
      else if (text.startsWith('-')) { file.deletions++; file.lines.push({ kind: 'removed', text, oldLine: oldLine++ }) }
      else if (text.startsWith(' ')) file.lines.push({ kind: 'context', text, oldLine: oldLine++, newLine: newLine++ })
      else file.lines.push({ kind: 'meta', text })
    } else {
      if (text.startsWith('new file mode ')) file.status = 'Added'
      if (text.startsWith('deleted file mode ')) file.status = 'Deleted'
      if (text.startsWith('rename from ')) { file.oldPath = decodeGitPath(text.slice(12)); file.status = 'Renamed' }
      if (text.startsWith('rename to ')) file.path = decodeGitPath(text.slice(10))
      if (text.startsWith('--- ') && text !== '--- /dev/null') file.oldPath = decodeGitPath(text.slice(4)).slice(2)
      if (text.startsWith('+++ ') && text !== '+++ /dev/null') file.path = decodeGitPath(text.slice(4)).slice(2)
      if (text.startsWith('Binary files ') || text === 'GIT binary patch') file.binary = true
      // Keep mode and rename information visible even when there are no text hunks.
      if (/^(old mode|new mode|new file mode|deleted file mode|rename from|rename to|similarity index) /.test(text)) file.lines.push({ kind: 'meta', text })
    }
  }
  return files
}
