import { execFile, type ChildProcess, type ExecFileOptions } from 'node:child_process'

export class GitCapacityError extends Error {
  readonly code = 'GIT_BUSY'
  readonly statusCode = 503
  constructor() { super('Git is busy. Please retry shortly.') }
}

let maximum = 4
let active = 0
let maintenance = false

// Maintenance owns the whole Git pool, including readers that may hold pack files.
export function acquireGitMaintenance(): () => void {
  if (active || maintenance) throw new GitCapacityError()
  maintenance = true
  active++
  let released = false
  return () => {
    if (released) return
    released = true
    active--
    maintenance = false
  }
}

export const getGitProcessStatus = () => ({ active, maximum })

// One backend process per deployment. Bound top-level Git commands, including
// browser reads and downloads; Git may start its own helper processes.
export function configureGitConcurrency(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid Git concurrency limit')
  maximum = limit
}

export function acquireGitProcess(): () => void {
  if (maintenance || active >= maximum) throw new GitCapacityError()
  active++
  let released = false
  return () => {
    if (released) return
    released = true
    active--
  }
}

export async function execGit(args: string[], options: ExecFileOptions = {}) {
  const release = acquireGitProcess()
  try { return await execGitInAcquiredSlot(args, options) } finally { release() }
}

// Only use while holding acquireGitProcess(), after any preceding child has
// closed. This lets transport finish HEAD synchronization in its existing slot.
export function execGitInAcquiredSlot(args: string[], options: ExecFileOptions = {}) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile('git', args, { timeout: 10_000, windowsHide: true, ...options, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) reject(error)
      else resolve({ stdout, stderr })
    })
  })
}

export async function terminateGitTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    // Kill only the process tree spawned for this operation.
    await new Promise<void>(resolve => {
      execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 }, () => resolve())
    })
    if (child.exitCode === null && child.signalCode === null) child.kill()
  } else {
    // Streaming Git children are detached into their own process group.
    try { process.kill(-child.pid, 'SIGKILL') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
}
