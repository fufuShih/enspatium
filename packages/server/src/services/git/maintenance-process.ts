import { spawn } from 'node:child_process'
import { terminateGitTree } from './process.js'
import { isolatedGitEnvironment } from './environment.js'

/** Caller owns the exclusive Git lease until this promise settles. */
export function runMaintenanceGit(args: string[], signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      env: isolatedGitEnvironment(), windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    })
    let failure: Error | undefined
    let termination: Promise<void> | undefined
    let bytes = 0
    const chunks: Buffer[] = []
    const diagnostics: Buffer[] = []
    const stop = (error: Error) => {
      failure ??= error
      // Do not release the lease when abort is requested. Wait for the process
      // tree termination and stdio close before allowing new readers/writers.
      termination ??= terminateGitTree(child)
      void termination.catch(() => { child.kill('SIGKILL') })
    }
    const abort = () => stop(new Error('Git maintenance timed out'))
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    const collect = (chunk: Buffer, stdout: boolean) => {
      bytes += chunk.length
      if (bytes > 4 * 1024 * 1024) stop(new Error('Git maintenance output limit exceeded'))
      else if (stdout) chunks.push(chunk)
      else diagnostics.push(chunk)
    }
    child.stdout.on('data', chunk => collect(chunk, true))
    child.stderr.on('data', chunk => collect(chunk, false))
    child.on('error', error => { failure ??= error })
    child.on('close', async code => {
      signal.removeEventListener('abort', abort)
      await termination?.catch(() => undefined)
      if (failure || code !== 0) reject(failure ?? new Error('Git maintenance command failed', { cause: { code, stderr: Buffer.concat(diagnostics).toString('utf8').slice(0, 8000) } }))
      else resolve(Buffer.concat(chunks).toString('utf8'))
    })
  })
}
