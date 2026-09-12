// Also runs as a standalone Git pre-receive hook: use only Node built-ins so
// Node 24 can run the source during development and compiled JS in production.
import { lstat, opendir, statfs } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
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
  await protectDefaultBranch()
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
}

// Preserve the quarantine environment supplied by receive-pack: new commits
// are not in the normal object store until this pre-receive check succeeds.
async function git(args: string[]) {
  return new Promise<{ code: number; stdout: string }>((resolve, reject) => {
    execFile('git', ['--no-replace-objects', ...args], { windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024, encoding: 'utf8' }, (error, stdout) => {
      if (error && (typeof error.code !== 'number' || error.killed)) reject(new Error('Unable to verify the protected default branch.'))
      else resolve({ code: error?.code as number ?? 0, stdout })
    })
  })
}

async function protectDefaultBranch() {
  const head = await git(['symbolic-ref', '--quiet', 'HEAD'])
  const protectedRef = head.stdout.trim()
  if (head.code || !protectedRef.startsWith('refs/heads/')) throw new Error('The default branch is unavailable. Contact the Space owner.')
  let pending = ''
  const decoder = new StringDecoder('utf8')
  let commands = 0
  async function check(line: string) {
    const match = /^([0-9a-f]{40}|[0-9a-f]{64}) ([0-9a-f]{40}|[0-9a-f]{64}) (refs\/[^\s]+)$/.exec(line)
    if (!match || ++commands > 10_000) throw new Error('Invalid or excessive Git reference updates.')
    const before = match[1]!, after = match[2]!, ref = match[3]!
    if (ref !== protectedRef) return
    if (/^0+$/.test(after)) throw new Error('The default branch is protected and cannot be deleted. Choose another default branch in Space settings first.')
    if (/^0+$/.test(before)) return // First push into an empty repository.
    const result = await git(['merge-base', '--is-ancestor', before, after])
    if (result.code === 1) throw new Error('The default branch is protected against force pushes. Merge or rebase your changes, then push again.')
    if (result.code) throw new Error('Unable to verify the protected default branch.')
  }
  for await (const chunk of process.stdin) {
    pending += decoder.write(chunk)
    let end: number
    while ((end = pending.indexOf('\n')) !== -1) {
      if (end > 16 * 1024) throw new Error('Git reference update is too long.')
      await check(pending.slice(0, end))
      pending = pending.slice(end + 1)
    }
    if (pending.length > 16 * 1024) throw new Error('Git reference update is too long.')
  }
  if (pending || decoder.end()) throw new Error('Incomplete Git reference update.')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runReceiveHook().catch((error: unknown) => {
    process.stderr.write((error instanceof Error ? error.message : 'Unable to verify Git storage limits') + '\n')
    process.exitCode = 1
  })
}
