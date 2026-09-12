// Also runs as a standalone Git pre-receive hook: use only Node built-ins so
// Node 24 can run the source during development and compiled JS in production.
import { lstat, opendir, statfs } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export async function measureGitObjects(directory: string, stopAfter = Number.MAX_SAFE_INTEGER): Promise<number> {
  let bytes = 0
  const pending = [directory]
  const deadline = Date.now() + 30_000
  while (pending.length) {
    if (Date.now() > deadline) throw new Error('Git storage measurement timed out')
    const path = pending.pop()!
    const info = await lstat(path)
    if (info.isSymbolicLink()) throw new Error('Unexpected link in Git objects')
    if (info.isDirectory()) {
      const entries = await opendir(path)
      for await (const entry of entries) pending.push(join(path, entry.name))
    } else if (info.isFile()) {
      bytes += info.size
      if (!Number.isSafeInteger(bytes)) throw new Error('Git storage size is out of range')
      if (bytes > stopAfter) return bytes
    } else throw new Error('Unexpected entry in Git objects')
  }
  return bytes
}

export async function freeDiskBytes(path: string): Promise<number> {
  const info = await statfs(path, { bigint: true })
  return Number(info.bavail * info.bsize)
}

async function runReceiveHook() {
  const maxBytes = Number(process.env.ENSP_GIT_MAX_BYTES)
  const minimumFree = Number(process.env.ENSP_MIN_FREE_BYTES)
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(minimumFree) || minimumFree < 0) {
    throw new Error('Git storage policy is unavailable')
  }
  // Git invokes receive hooks from the bare repository. Its quarantine is a
  // child of objects, so this includes both existing and incoming objects.
  // No refs have changed yet; rejecting lets Git remove the quarantine.
  const objects = join(process.cwd(), 'objects')
  if (await measureGitObjects(objects, maxBytes) > maxBytes) {
    throw new Error('Repository storage limit exceeded. Contact the administrator.')
  }
  if (await freeDiskBytes(objects) < minimumFree) {
    throw new Error('Storage is low on free space. Please try again later.')
  }
  // Drain ref commands without accumulating an unbounded list in memory.
  for await (const _chunk of process.stdin) { /* no ref changes in this hook */ }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runReceiveHook().catch((error: unknown) => {
    process.stderr.write((error instanceof Error ? error.message : 'Unable to verify Git storage limits') + '\n')
    process.exitCode = 1
  })
}
