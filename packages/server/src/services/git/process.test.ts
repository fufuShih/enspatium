import { afterEach, expect, test } from 'vitest'
import { acquireGitMaintenance, acquireGitProcess, configureGitConcurrency, execGit, getGitProcessStatus } from './process.js'

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

test('maintenance refuses active readers and blocks all new commands until released', () => {
  const reader = acquireGitProcess()
  try { expect(() => acquireGitMaintenance()).toThrow('Git is busy') } finally { reader() }
  const release = acquireGitMaintenance()
  try {
    expect(getGitProcessStatus().active).toBe(1)
    expect(() => acquireGitProcess()).toThrow('Git is busy')
    expect(() => acquireGitMaintenance()).toThrow('Git is busy')
  } finally { release() }
  release()
  expect(getGitProcessStatus().active).toBe(0)
  acquireGitProcess()()
})
