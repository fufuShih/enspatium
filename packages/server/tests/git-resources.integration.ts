import { randomBytes, randomUUID } from 'node:crypto'
import { readdir, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import type { PublicUser } from '../src/db/types/user.types.js'
import type { PublicSpace } from '../src/db/types/space.types.js'
import type { CreatedPersonalAccessToken } from '../src/db/types/token.types.js'
import { acquireGitProcess, configureGitConcurrency } from '../src/services/git/process.js'
import { createFixture } from './fixture.js'

test('Git limits reject oversized, full, low-disk and busy pushes while preserving cloneable history', async ({ onTestFinished }) => {
  const { root, app, origin, session, git } = await createFixture({ after: onTestFinished, diagnostic: console.info })
  const owner = session()
  const password = 'Trial-' + randomUUID()
  const user = await owner.request<PublicUser>('POST', '/users', 201, { email: 'git-limits@example.com', displayName: 'Limits', password })
  await owner.request('POST', '/auth/login', 200, { email: user.email, password })
  await owner.request('POST', '/namespaces', 201, { name: 'Git limits', slug: 'git-limits' })
  const base = '/namespaces/git-limits/spaces/repository'
  const space = await owner.request<PublicSpace>('POST', '/namespaces/git-limits/spaces', 201, { name: 'Repository', slug: 'repository', type: 'git', visibility: 'private' })
  const token = await owner.request<CreatedPersonalAccessToken>('POST', '/auth/tokens', 201, { name: 'Git limits', scopes: ['git:read', 'git:write'] })
  const url = origin + '/git/git-limits/repository.git'
  const repository = join(app.config.DATA_ROOT, space.id)
  const work = join(root, 'worktree')
  const usage = () => owner.request<{ usedBytes: number; maxBytes: number; maxPushBytes: number }>('GET', base + '/git/storage')
  await session().request('GET', base + '/git/storage', 401)
  expect((await usage()).usedBytes).toBe(0)
  await git(['init', '--initial-branch=main', work])
  await git(['-C', work, 'remote', 'add', 'origin', url])
  await writeFile(join(work, 'README.md'), '# Trial repository\n')
  await git(['-C', work, 'add', '.'])
  await git(['-C', work, 'commit', '-m', 'Initial commit'])
  const push = () => git(['-C', work, 'push', 'origin', 'main'], token.token)
  const head = async () => (await git(['--git-dir=' + repository, 'rev-parse', 'refs/heads/main'])).stdout.trim()
  await push()
  const initial = await head()
  const initialUsage = await usage()
  expect(initialUsage.usedBytes).toBeGreaterThan(0)
  expect(initialUsage.maxPushBytes).toBe(app.config.GIT_MAX_PUSH_BYTES)

  await writeFile(join(work, 'random.bin'), randomBytes(64 * 1024))
  await git(['-C', work, 'add', '.'])
  await git(['-C', work, 'commit', '-m', 'New content'])
  app.config.GIT_MAX_PUSH_BYTES = 1024
  await expect(push()).rejects.toMatchObject({ stderr: expect.stringMatching(/maximum allowed size|max-input-size|unpacker error/i) })
  expect(await head()).toBe(initial)
  expect((await usage()).usedBytes).toBe(initialUsage.usedBytes)

  // The complete HTTP body is bounded even when Content-Length is absent.
  const chunkedStatus = await new Promise<number>((resolve, reject) => {
    const req = httpRequest(url + '/git-receive-pack', {
      method: 'POST', headers: {
        authorization: 'Basic ' + Buffer.from('git:' + token.token).toString('base64'),
        'content-type': 'application/x-git-receive-pack-request',
      },
    }, response => { response.resume(); response.on('end', () => resolve(response.statusCode!)) })
    req.on('error', reject)
    req.setTimeout(10_000, () => req.destroy(new Error('Chunked request timed out')))
    req.write(Buffer.alloc(600 * 1024))
    req.end(Buffer.alloc(600 * 1024))
  })
  expect(chunkedStatus).toBe(413)
  expect(await head()).toBe(initial)

  app.config.GIT_MAX_PUSH_BYTES = 1024 * 1024
  app.config.GIT_REPOSITORY_MAX_BYTES = initialUsage.usedBytes + 1024
  await expect(push()).rejects.toMatchObject({ stderr: expect.stringMatching(/Repository storage limit exceeded/) })
  expect(await head()).toBe(initial)
  expect((await usage()).usedBytes).toBe(initialUsage.usedBytes)
  expect((await readdir(join(repository, 'objects'))).some(name => name.startsWith('incoming-'))).toBe(false)

  app.config.GIT_REPOSITORY_MAX_BYTES = 1024
  await expect(push()).rejects.toMatchObject({ stderr: expect.stringMatching(/507/) })
  await git(['clone', url, join(root, 'clone-while-full')], token.token)
  expect(await head()).toBe(initial)

  app.config.GIT_REPOSITORY_MAX_BYTES = 1024 * 1024
  app.config.STORAGE_MIN_FREE_BYTES = Number.MAX_SAFE_INTEGER
  await expect(push()).rejects.toMatchObject({ stderr: expect.stringMatching(/507/) })
  expect(await head()).toBe(initial)
  app.config.STORAGE_MIN_FREE_BYTES = 0

  const interrupted = httpRequest(url + '/git-receive-pack', {
    method: 'POST', headers: {
      authorization: 'Basic ' + Buffer.from('git:' + token.token).toString('base64'),
      'content-type': 'application/x-git-receive-pack-request',
    },
  })
  interrupted.on('error', () => { /* expected when aborting the client */ })
  interrupted.write('0000')
  const pendingUpload = async () => (await readdir(repository)).some(name => name.startsWith('.ensp-push-'))
  try {
    await expect.poll(pendingUpload).toBe(true)
    await expect(push()).rejects.toMatchObject({ stderr: expect.stringMatching(/409/) })
  } finally { interrupted.destroy() }
  await expect.poll(pendingUpload).toBe(false)
  expect(await head()).toBe(initial)

  configureGitConcurrency(1)
  try {
    const releaseProcess = acquireGitProcess()
    try {
      expect(await owner.request('GET', base + '/git', 503)).toMatchObject({ code: 'GIT_BUSY' })
      await expect(push()).rejects.toMatchObject({ stderr: expect.stringMatching(/503/) })
    } finally { releaseProcess() }
    // A single slot still supports a full push, HEAD sync, browsing and clone.
    await push()
    expect(await head()).not.toBe(initial)
    await owner.request('GET', base + '/git')
    await git(['clone', url, join(root, 'clone-after-limits')], token.token)
    expect(await readdir(repository)).not.toEqual(expect.arrayContaining([expect.stringMatching(/^\.ensp-(push|hooks)-/)]))
    await git(['--git-dir=' + repository, 'fsck', '--full', '--strict'])
  } finally { configureGitConcurrency(4) }
})
