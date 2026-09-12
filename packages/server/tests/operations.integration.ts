import { randomUUID } from 'node:crypto'
import { lstat, rename } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { dirname, join } from 'node:path'
import { expect, test } from 'vitest'
import type { PublicUser } from '../src/db/types/user.types.js'
import type { PublicSpace } from '../src/db/types/space.types.js'
import type { CreatedPersonalAccessToken } from '../src/db/types/token.types.js'
import type { OperationsStatus } from '../src/services/operations.js'
import { acquireGitProcess } from '../src/services/git/process.js'
import { createFixture } from './fixture.js'

test('admin operations report bounded probes, missing storage, Git capacity and sanitized failures', async ({ onTestFinished }) => {
  const { app, root, origin, session } = await createFixture({ after: onTestFinished, diagnostic: console.info })
  const admin = session()
  const password = 'Operations-' + randomUUID()
  const user = await admin.request<PublicUser>('POST', '/users', 201, { email: 'operations@example.test', displayName: 'Operations admin', password })
  await admin.request('POST', '/auth/login', 200, { email: user.email, password })
  await session().request('GET', '/admin/operations', 401)
  await admin.request('GET', '/admin/operations', 403)
  await app.db.updateTable('users').set({ is_admin: true }).where('id', '=', user.id).execute()
  const status = () => admin.request<OperationsStatus>('GET', '/admin/operations')
  expect(await status()).toMatchObject({ status: 'ok', databaseReady: true, storage: { available: true }, errors: { total: 0 } })

  const release = acquireGitProcess()
  try { expect((await status()).git.active).toBe(1) } finally { release() }
  expect((await status()).git.active).toBe(0)
  const minimumFree = app.config.STORAGE_MIN_FREE_BYTES
  app.config.STORAGE_MIN_FREE_BYTES = Number.MAX_SAFE_INTEGER
  try { expect((await status()).alerts).toContain('low-disk-space') } finally { app.config.STORAGE_MIN_FREE_BYTES = minimumFree }
  expect((await status()).alerts).not.toContain('low-disk-space')

  const dataRoot = app.config.DATA_ROOT
  expect(dirname(dataRoot)).toBe(root)
  const offlineRoot = dataRoot + '-offline'
  expect(dirname(offlineRoot)).toBe(root)
  await rename(dataRoot, offlineRoot)
  try {
    expect(await status()).toMatchObject({ status: 'degraded', storage: { available: false, freeBytes: null }, alerts: ['storage-unavailable'] })
    await expect(lstat(dataRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await rename(offlineRoot, dataRoot) }
  expect((await status()).storage.available).toBe(true)

  // A TCP server that never speaks PostgreSQL proves the probe has a real
  // connection timeout without stopping or altering the developer database.
  const sockets = new Set<Socket>()
  const stalled = createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  await new Promise<void>(resolve => stalled.listen(0, '127.0.0.1', resolve))
  const address = stalled.address()
  if (!address || typeof address === 'string') throw new Error('Test listener did not start')
  const originalUrl = app.config.DATABASE_URL
  app.config.DATABASE_URL = `postgres://private-probe-user:private-probe-password@127.0.0.1:${address.port}/private-probe-database`
  try {
    const began = Date.now()
    const failed = await status()
    expect(failed.databaseReady).toBe(false)
    expect(failed.alerts).toContain('database-unavailable')
    expect(Date.now() - began).toBeLessThan(9000)
    expect(JSON.stringify(failed)).not.toContain('private-probe')
  } finally {
    app.config.DATABASE_URL = originalUrl
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve, reject) => stalled.close(error => error ? reject(error) : resolve()))
  }
  expect((await status()).databaseReady).toBe(true)

  await admin.request('POST', '/namespaces', 201, { name: 'Private operations team', slug: 'private-operations-team' })
  const base = '/namespaces/private-operations-team/spaces/private-repository'
  const space = await admin.request<PublicSpace>('POST', '/namespaces/private-operations-team/spaces', 201, { name: 'Private repo', slug: 'private-repository', type: 'git', visibility: 'private' })
  const path = join(dataRoot, space.id)
  const hidden = path + '-offline'
  expect(dirname(hidden)).toBe(dataRoot)
  await rename(path, hidden)
  try { await admin.request('GET', base + '/git?private-query=private-query-secret', 503) } finally { await rename(hidden, path) }
  const failure = await status()
  expect(failure.errors.total).toBe(1)
  expect(failure.errors.recent[0]).toMatchObject({ kind: 'http', route: '/namespaces/:namespaceSlug/spaces/:spaceSlug/git', statusCode: 503 })
  expect(JSON.stringify(failure)).not.toMatch(/private-query|private-operations-team|private-repository|operations@example/)

  const token = await admin.request<CreatedPersonalAccessToken>('POST', '/auth/tokens', 201, { name: 'Invalid transport test', scopes: ['git:read'] })
  try {
    const response = await fetch(origin + '/git/private-operations-team/private-repository.git/git-upload-pack', {
      method: 'POST', headers: { 'content-type': 'application/x-git-upload-pack-request', authorization: 'Basic ' + Buffer.from('git:' + token.token).toString('base64') },
      body: 'not a valid Git packet', signal: AbortSignal.timeout(10_000),
    })
    await response.arrayBuffer()
  } catch { /* a failed CGI stream can terminate the socket */ }
  const afterGit = await status()
  expect(afterGit.errors.recent.some(error => error.kind === 'git' && error.statusCode === 502)).toBe(true)
  expect(afterGit.errors.total).toBe(2) // raw stream failure is counted only once
  expect(JSON.stringify(afterGit)).not.toContain(token.token)
  await app.db.updateTable('users').set({ is_admin: false }).where('id', '=', user.id).execute()
  await admin.request('GET', '/admin/operations', 403)
})
