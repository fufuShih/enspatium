import { afterEach, expect, test } from 'vitest'
import { acquireGitProcess, configureGitConcurrency, execGit } from './process.js'

afterEach(() => configureGitConcurrency(4))

test('bounds active commands and releases leases idempotently', () => {
  configureGitConcurrency(1)
  const release = acquireGitProcess()
  try { expect(() => acquireGitProcess()).toThrow('Git is busy') } finally { release() }
  release()
  const next = acquireGitProcess()
  try { expect(() => acquireGitProcess()).toThrow('Git is busy') } finally { next() }
})

test('failed Git commands return their slot', async () => {
  configureGitConcurrency(1)
  await expect(execGit(['not-an-enspatium-git-command'])).rejects.toThrow()
  expect((await execGit(['--version'])).stdout).toContain('git version')
})
