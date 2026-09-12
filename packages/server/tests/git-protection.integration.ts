import { randomUUID } from 'node:crypto'
import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import type { PublicUser } from '../src/db/types/user.types.js'
import type { PublicSpace } from '../src/db/types/space.types.js'
import type { CreatedPersonalAccessToken } from '../src/db/types/token.types.js'
import { acquireStorageWrite } from '../src/services/space/storage-access.js'
import { createFixture } from './fixture.js'

test('default branch protection rejects force and deletion, follows owner selection, preserves atomic rejection and accurate push audits', async ({ onTestFinished }) => {
  const { app, root, origin, session, git } = await createFixture({ after: onTestFinished, diagnostic: console.info })
  const owner = session(), writer = session()
  async function account(client: ReturnType<typeof session>, name: string) {
    const password = 'Protection-' + randomUUID()
    const user = await client.request<PublicUser>('POST', '/users', 201, { email: name + '@example.test', displayName: name, password })
    await client.request('POST', '/auth/login', 200, { email: user.email, password })
    const token = await client.request<CreatedPersonalAccessToken>('POST', '/auth/tokens', 201, { name: 'Protection test', scopes: ['git:read', 'git:write'] })
    return { user, token: token.token }
  }
  const ownerAccount = await account(owner, 'protection-owner')
  const writerAccount = await account(writer, 'protection-writer')
  await owner.request('POST', '/namespaces', 201, { name: 'Protection', slug: 'protection' })
  await owner.request('POST', '/namespaces/protection/members', 201, { email: writerAccount.user.email, role: 'member' })
  const base = '/namespaces/protection/spaces/repository'
  const space = await owner.request<PublicSpace>('POST', '/namespaces/protection/spaces', 201, { name: 'Repository', slug: 'repository', type: 'git', visibility: 'private' })
  await owner.request('POST', base + '/members', 201, { email: writerAccount.user.email, role: 'writer' })
  const repository = join(app.config.DATA_ROOT, space.id)
  const source = join(root, 'work')
  const remote = origin + '/git/protection/repository.git'
  await git(['init', '--initial-branch=main', source])
  await git(['-C', source, 'remote', 'add', 'origin', remote])
  async function commit(content: string) {
    await writeFile(join(source, 'README.md'), content)
    await git(['-C', source, 'add', '.'])
    await git(['-C', source, 'commit', '-m', content.trim()])
    return (await git(['-C', source, 'rev-parse', 'HEAD'])).stdout.trim()
  }
  const initial = await commit('Initial contents\n')
  const push = (args: string[], token = ownerAccount.token) => git(['-C', source, 'push', 'origin', ...args], token)
  await push(['main'])
  const latest = await commit('Fast-forward contents\n')
  await push(['main'], writerAccount.token)
  await push([latest + ':refs/heads/topic', latest + ':refs/heads/release/正式版'])
  const ref = async (name: string) => (await git(['--git-dir', repository, 'rev-parse', name])).stdout.trim()
  const auditCount = async () => (await app.db.selectFrom('audit_events').select('id').where('space_id', '=', space.id).where('action', '=', 'git.pushed').execute()).length
  // Git transport may finish writing its audit shortly after the client exits.
  await expect.poll(auditCount).toBe(3)
  // Replacement refs must not falsify the ancestry used by the protection
  // check: make the old commit appear to descend from the current default.
  const replacement = (await git(['-C', source, 'commit-tree', latest + '^{tree}', '-p', latest, '-m', 'Replacement ancestry'])).stdout.trim()
  await push([replacement + ':refs/replace/' + initial])
  await expect(push(['--force', initial + ':main'])).rejects.toMatchObject({ stderr: expect.stringContaining('protected against force pushes') })
  expect(await ref('refs/heads/main')).toBe(latest)
  await push(['--delete', 'refs/replace/' + initial])
  await expect.poll(auditCount).toBe(5)
  for (const token of [ownerAccount.token, writerAccount.token]) {
    await expect(push(['--force', initial + ':main'], token)).rejects.toMatchObject({ stderr: expect.stringContaining('protected against force pushes') })
    await expect(push(['--delete', 'main'], token)).rejects.toMatchObject({ stderr: expect.stringContaining('protected and cannot be deleted') })
    expect(await ref('refs/heads/main')).toBe(latest)
  }
  // A protected-ref rejection in pre-receive rejects every update, even without
  // --atomic. The accompanying new branch must not become visible.
  await expect(push(['--force', initial + ':main', latest + ':refs/heads/should-not-exist'])).rejects.toMatchObject({ stderr: expect.stringContaining('protected against force pushes') })
  await expect(ref('refs/heads/should-not-exist')).rejects.toThrow()
  expect(await auditCount()).toBe(5)
  await push(['--force', initial + ':topic']) // other branches retain normal semantics
  await push(['--delete', 'topic'])
  await expect.poll(auditCount).toBe(7)

  await writer.request('PATCH', base + '/git/default-branch', 403, { branch: 'release/正式版' })
  const writing = acquireStorageWrite(app.config.DATA_ROOT)
  try { await owner.request('PATCH', base + '/git/default-branch', 409, { branch: 'release/正式版' }) }
  finally { writing() }
  expect((await git(['--git-dir', repository, 'symbolic-ref', 'HEAD'])).stdout.trim()).toBe('refs/heads/main')
  await owner.request('PATCH', base + '/git/default-branch', 200, { branch: 'release/正式版' })
  await expect(push(['--force', initial + ':refs/heads/release/正式版'])).rejects.toMatchObject({ stderr: expect.stringContaining('protected against force pushes') })
  await expect(push(['--delete', 'release/正式版'])).rejects.toMatchObject({ stderr: expect.stringContaining('protected and cannot be deleted') })
  await push(['--force', initial + ':main'])
  await push(['--delete', 'main'])
  await expect.poll(auditCount).toBe(9)
  expect(await ref('refs/heads/release/正式版')).toBe(latest)
  await git(['clone', remote, join(root, 'clone')], ownerAccount.token)
  expect((await git(['-C', join(root, 'clone'), 'branch', '--show-current'])).stdout.trim()).toBe('release/正式版')
  expect((await readdir(repository)).some(name => name.startsWith('.ensp-hooks-') || name.startsWith('.ensp-push-'))).toBe(false)
  expect((await readdir(join(repository, 'objects'))).some(name => name.startsWith('incoming-'))).toBe(false)
})
