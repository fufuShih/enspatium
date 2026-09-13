export interface GitEntryCommit {
  id: string
  shortId: string
  committedAt: string
  message: string
}

// Raw diff records are NUL-delimited. Consume filenames as values rather than
// looking for commit delimiters inside them (Git permits newlines and colons).
export function parseTreeHistory(output: string, folder: string, names: readonly string[]) {
  const commits = new Map<string, GitEntryCommit>()
  const wanted = new Set(names)
  const prefix = folder ? folder + '/' : ''
  const tokens = output.split('\0')
  let commit: GitEntryCommit | undefined
  for (let index = 0; index < tokens.length && commits.size < wanted.size;) {
    const token = tokens[index++]!
    if (!token || token === '\n') continue
    if (/^[0-9a-f]{40,64}$/.test(token)) {
      const shortId = tokens[index++], committedAt = tokens[index++], message = tokens[index++]
      if (!shortId || !committedAt || message === undefined || !Number.isFinite(Date.parse(committedAt))) break
      commit = { id: token, shortId, committedAt, message }
    } else if (/^\n?:[0-7]{6} [0-7]{6} [0-9a-f]+ [0-9a-f]+ [A-Z]$/.test(token)) {
      const path = tokens[index++]
      if (!commit || path === undefined || !path.startsWith(prefix)) continue
      const name = path.slice(prefix.length).split('/')[0]!
      if (wanted.has(name) && !commits.has(name)) commits.set(name, commit)
    } else {
      // An incomplete or unexpected record must not attach the wrong commit.
      break
    }
  }
  return commits
}
