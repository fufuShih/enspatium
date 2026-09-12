import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { expect, test } from 'vitest'
import { runMaintenanceGit } from './maintenance-process.js'

test('cancelling a Git command waits for its spawned process tree to stop', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ensp-maintenance-process-'))
  const controller = new AbortController()
  let running: Promise<string> | undefined
  try {
    await writeFile(join(root, 'hang.cjs'), `
      const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, ['-e', "setInterval(() => {}, 1000)"], { stdio: 'inherit' });
      require('node:fs').writeFileSync('child.pid', String(child.pid));
      setInterval(() => {}, 1000);
    `)
    running = runMaintenanceGit(['-C', root, '-c', 'alias.test-hang=!node hang.cjs', 'test-hang'], controller.signal)
    // Attach rejection handling before cancellation to avoid unhandled promises.
    const settled = running.catch(error => error as Error)
    await expect.poll(async () => readFile(join(root, 'child.pid'), 'utf8').catch(() => '')).toMatch(/^\d+$/)
    const pid = Number(await readFile(join(root, 'child.pid'), 'utf8'))
    controller.abort()
    expect(await settled).toBeInstanceOf(Error)
    expect(() => process.kill(pid, 0)).toThrow()
  } finally {
    controller.abort()
    await running?.catch(() => undefined)
    expect(dirname(resolve(root))).toBe(resolve(tmpdir()))
    expect(root.startsWith(join(tmpdir(), 'ensp-maintenance-process-'))).toBe(true)
    await rm(root, { recursive: true, force: true })
  }
})
