import { randomUUID } from 'node:crypto'
import { chmod, readFile, readdir, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, vi } from 'vitest'
import type { PublicUser } from '../src/db/types/user.types.js'
import type { PublicSpace } from '../src/db/types/space.types.js'
import type { CreatedPersonalAccessToken } from '../src/db/types/token.types.js'
import type { GitMaintenanceJob } from '../src/services/git/maintenance.js'
import { acquireStorageWrite } from '../src/services/space/storage-access.js'
import { acquireGitProcess, getGitProcessStatus } from '../src/services/git/process.js'
import * as maintenanceProcess from '../src/services/git/maintenance-process.js'
import * as audit from '../src/services/audit/audit.js'
import { createFixture } from './fixture.js'

test('admin maintenance preserves refs and clone content, prunes only old unreferenced objects and rejects unsafe work', async ({ onTestFinished }) => {
  const { app, root, origin, session, git } = await createFixture({ after: onTestFinished, diagnostic: console.info })
  const warnings = vi.spyOn(app.log, 'warn')
  const admin = session()
  const password = 'Maintenance-' + randomUUID()
  const user = await admin.request<PublicUser>('POST', '/users', 201, { email: 'maintenance@example.test', displayName: 'Maintenance admin', password })
  await admin.request('POST', '/auth/login', 200, { email: user.email, password })
  const endpoint = '/admin/git/maintenance'
  for (const route of [endpoint, '/admin/git/spaces']) {
    await session().request('GET', route, 401)
    await admin.request('GET', route, 403)
  }
  await admin.request('POST', endpoint, 403, { spaceId: randomUUID() })
  await app.db.updateTable('users').set({ is_admin: true }).where('id', '=', user.id).execute()
  expect(await admin.request('GET', endpoint)).toEqual({ job: null })
  await admin.request('POST', '/namespaces', 201, { name: 'Maintenance', slug: 'maintenance' })
  const create = (slug: string, type = 'git') => admin.request<PublicSpace>('POST', '/namespaces/maintenance/spaces', 201, { name: slug, slug, type, visibility: 'private' })
  const space = await create('repository')
  const empty = await create('empty')
  const object = await create('object', 'object')
  const token = await admin.request<CreatedPersonalAccessToken>('POST', '/auth/tokens', 201, { name: 'Maintenance transport', scopes: ['git:read', 'git:write'] })
  const repo = join(app.config.DATA_ROOT, space.id)
  const work = join(root, 'work')
  const url = origin + '/git/maintenance/repository.git'
  await git(['init', '--initial-branch=main', work])
  await writeFile(join(work, 'README.md'), '# Maintained repository\n')
  await git(['-C', work, 'add', '.'])
  await git(['-C', work, 'commit', '-m', 'Initial commit'])
  await git(['-C', work, 'branch', 'feature'])
  await git(['-C', work, 'tag', '-a', 'v1', '-m', 'First release'])
  await git(['-C', work, 'push', url, 'main', 'feature', 'v1'], token.token)
  const refs = async () => (await git(['--git-dir', repo, 'for-each-ref', '--format=%(refname) %(objectname)'])).stdout
  const originalRefs = await refs()
  async function blob(name: string, old = false) {
    const file = join(root, name)
    await writeFile(file, name)
    const hash = (await git(['--git-dir', repo, 'hash-object', '-w', file])).stdout.trim()
    if (old) await utimes(join(repo, 'objects', hash.slice(0, 2), hash.slice(2)), new Date('2000-01-01'), new Date('2000-01-01'))
    return hash
  }
  const recent = await blob('recent-unreferenced')
  const old = await blob('old-unreferenced', true)
  const start = (id = space.id) => admin.request<GitMaintenanceJob>('POST', endpoint, 202, { spaceId: id })
  const finish = async () => {
    await expect.poll(async () => (await admin.request<{ job: GitMaintenanceJob }>('GET', endpoint)).job.phase, { timeout: 20_000 }).toBe('finished')
    return (await admin.request<{ job: GitMaintenanceJob }>('GET', endpoint)).job
  }
  const list = await admin.request<{ spaces: { id: string }[] }>('GET', '/admin/git/spaces?search=repository')
  expect(list.spaces.map(item => item.id)).toEqual([space.id])
  await admin.request('POST', endpoint, 404, { spaceId: object.id })
  await admin.request('POST', endpoint, 404, { spaceId: randomUUID() })
  const writer = acquireStorageWrite(app.config.DATA_ROOT)
  try { await admin.request('POST', endpoint, 409, { spaceId: space.id }) } finally { writer() }

  // Hold the first leased Git command, proving readers/writers and another job
  // are rejected while a real maintenance job owns the resources.
  const originalRun = maintenanceProcess.runMaintenanceGit
  let resume!: () => void
  const gate = new Promise<void>(resolve => { resume = resolve })
  const spy = vi.spyOn(maintenanceProcess, 'runMaintenanceGit').mockImplementationOnce(async (args, signal) => { await gate; return originalRun(args, signal) })
  try {
    await start()
    await expect.poll(() => spy.mock.calls.length).toBeGreaterThan(0)
    expect(() => acquireGitProcess()).toThrow('Git is busy')
    expect(() => acquireStorageWrite(app.config.DATA_ROOT)).toThrow('Storage is busy')
    await admin.request('POST', endpoint, 409, { spaceId: empty.id })
    await admin.request('GET', '/namespaces/maintenance/spaces/repository/git', 503)
    resume()
    const completed = await finish()
    expect(completed, completed.message + JSON.stringify(warnings.mock.calls, (_key, value) => value instanceof Error ? { message: value.message, cause: value.cause } : value)).toMatchObject({ status: 'completed', auditRecorded: true, beforeBytes: expect.any(Number), afterBytes: expect.any(Number) })
  } finally { resume(); spy.mockRestore() }
  expect(await refs()).toBe(originalRefs)
  expect((await git(['--git-dir', repo, 'symbolic-ref', 'HEAD'])).stdout.trim()).toBe('refs/heads/main')
  await git(['--git-dir', repo, 'cat-file', '-e', recent])
  await expect(git(['--git-dir', repo, 'cat-file', '-e', old])).rejects.toThrow()
  await git(['clone', url, join(root, 'clone')], token.token)
  expect(await readFile(join(root, 'clone', 'README.md'), 'utf8')).toBe('# Maintained repository\n')
  expect((await readdir(join(repo, 'objects', 'pack'))).some(name => name.endsWith('.pack'))).toBe(true)
  expect(getGitProcessStatus().active).toBe(0)
  const audits = await app.db.selectFrom('audit_events').select(['action', 'metadata']).where('space_id', '=', space.id).where('action', 'in', ['git.maintenance_started', 'git.maintained']).execute()
  expect(audits).toHaveLength(2)
  expect(audits.find(event => event.action === 'git.maintained')?.metadata.status).toBe('completed')
  await start(empty.id)
  expect((await finish()).status).toBe('completed')

  const reader = acquireGitProcess()
  try { await start(); expect(await finish()).toMatchObject({ status: 'failed', message: expect.stringContaining('Git is busy') }) }
  finally { reader() }

  const minimum = app.config.STORAGE_MIN_FREE_BYTES
  app.config.STORAGE_MIN_FREE_BYTES = Number.MAX_SAFE_INTEGER
  try { await start(); expect(await finish()).toMatchObject({ status: 'failed', message: expect.stringContaining('free disk space') }) }
  finally { app.config.STORAGE_MIN_FREE_BYTES = minimum }
  expect(await refs()).toBe(originalRefs)
  const config = join(repo, 'config')
  const savedConfig = await readFile(config)
  await writeFile(config, Buffer.concat([savedConfig, Buffer.from('\n[fsck]\n missingEmail = ignore\n')]))
  try { await start(); expect(await finish()).toMatchObject({ status: 'failed', message: expect.stringContaining('Integrity check did not pass') }) }
  finally { await writeFile(config, savedConfig) }
  await writeFile(config, Buffer.concat([savedConfig, Buffer.from('\n[gc]\n recentObjectsHook = exit 1\n')]))
  try { await start(); expect(await finish()).toMatchObject({ status: 'failed', message: expect.stringContaining('GC hooks') }) }
  finally { await writeFile(config, savedConfig) }
  const corrupt = await blob('corrupted-test-object')
  const corruptPath = join(repo, 'objects', corrupt.slice(0, 2), corrupt.slice(2))
  const savedObject = await readFile(corruptPath)
  await chmod(corruptPath, 0o600)
  await writeFile(corruptPath, 'invalid compressed object')
  try { await start(); expect(await finish()).toMatchObject({ status: 'failed', message: expect.stringContaining('Integrity check did not pass') }) }
  finally { await writeFile(corruptPath, savedObject); await chmod(corruptPath, 0o444) }
  const failure = vi.spyOn(maintenanceProcess, 'runMaintenanceGit').mockRejectedValueOnce(new Error('Simulated Git failure'))
  try { await start(); expect((await finish()).status).toBe('failed') }
  finally { failure.mockRestore() }
  const createAudit = audit.createAuditEvent
  const auditFailure = vi.spyOn(audit, 'createAuditEvent').mockImplementationOnce(createAudit).mockRejectedValueOnce(new Error('Simulated completion audit failure'))
  try {
    await start()
    expect(await finish()).toMatchObject({ status: 'completed', auditRecorded: false, message: expect.stringContaining('completion audit could not be saved') })
    expect(await refs()).toBe(originalRefs)
  } finally { auditFailure.mockRestore() }
  acquireStorageWrite(app.config.DATA_ROOT)()
  acquireGitProcess()()
  await app.db.updateTable('users').set({ is_admin: false }).where('id', '=', user.id).execute()
  await admin.request('GET', endpoint, 403)
  await admin.request('POST', endpoint, 403, { spaceId: space.id })
  await app.db.updateTable('users').set({ is_admin: true }).where('id', '=', user.id).execute()
  // Graceful shutdown waits for admitted work before closing the database.
  let finishShutdown!: () => void
  const shutdownGate = new Promise<void>(resolve => { finishShutdown = resolve })
  const shutdownSpy = vi.spyOn(maintenanceProcess, 'runMaintenanceGit').mockImplementationOnce(async (args, signal) => { await shutdownGate; return originalRun(args, signal) })
  let closed = false
  let closing: Promise<void> | undefined
  try {
    await start()
    await expect.poll(() => shutdownSpy.mock.calls.length).toBeGreaterThan(0)
    closing = app.close().then(() => { closed = true })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(closed).toBe(false)
    finishShutdown()
    await closing
    expect(app.gitMaintenance.getStatus().job).toMatchObject({ status: 'completed', phase: 'finished', auditRecorded: true })
    acquireStorageWrite(app.config.DATA_ROOT)()
    expect(getGitProcessStatus().active).toBe(0)
  } finally { finishShutdown(); await closing; shutdownSpy.mockRestore(); warnings.mockRestore() }
})
