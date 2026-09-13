import type { DiffLine } from './gitHistoryApi'

export type SplitDiffCell = DiffLine & { noNewline?: boolean }
export type SplitDiffRow = { before?: SplitDiffCell; after?: SplitDiffCell; meta?: string }

// Pair each contiguous block of removals/additions; context and hunk boundaries
// end a block. Unequal blocks leave blank cells on the shorter side.
export function splitDiffLines(lines: readonly DiffLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = []
  let removed: SplitDiffCell[] = [], added: SplitDiffCell[] = []
  let previous: SplitDiffCell | undefined
  const flush = () => {
    for (let i = 0; i < Math.max(removed.length, added.length); i++) rows.push({ before: removed[i], after: added[i] })
    removed = []; added = []
  }
  for (const line of lines) {
    if (line.kind === 'meta' && line.text === '\\ No newline at end of file' && previous) {
      previous.noNewline = true
      continue
    }
    const cell = { ...line }
    if (line.kind === 'removed') {
      if (added.length) flush()
      removed.push(cell)
    } else if (line.kind === 'added') added.push(cell)
    else {
      flush()
      rows.push(line.kind === 'context' ? { before: cell, after: cell } : { meta: line.text })
    }
    previous = line.kind === 'meta' ? undefined : cell
  }
  flush()
  return rows
}
