import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import type { PublicNamespace } from '../src/db/namespace.types.js'
import type { PublicSpace } from '../src/db/space.types.js'
import type { CreatedPersonalAccessToken } from '../src/db/token.types.js'
import type { PublicUser } from '../src/db/user.types.js'
import type { GitRepositoryInfo } from '../src/services/git/repository.js'
import { createFixture } from './fixture.js'

test('real authentication, Space collaboration and Git transport', { timeout: 120_000 }, async t => {
  const { root, origin, app, git, session } = await createFixture(t)
  const owner = session()
  const member = session()
  const guest = session()
  const password = 'Integration-' + randomUUID()
  const account = 'integration-team'
  const namespace = '/namespaces/' + account
  const spaceUrl = namespace + '/spaces/demo'
  const remote = origin + '/git/' + account + '/demo.git'

  const ownerUser = await owner.request<PublicUser>('POST', '/users', 201, {
    email: 'owner@example.com', displayName: 'Owner', password,
  })
  const memberUser = await member.request<PublicUser>('POST', '/users', 201, {
    email: 'member@example.com', displayName: 'Member', password,
  })
  await owner.request('GET', '/auth/me', 401)
  await owner.request('POST', '/auth/login', 401, { email: ownerUser.email, password: 'wrong-password' })
  await owner.request('POST', '/auth/login', 200, { email: ownerUser.email, password })
  await member.request('POST', '/auth/login', 200, { email: memberUser.email, password })
  assert.equal((await owner.request<PublicUser>('GET', '/auth/me')).id, ownerUser.id)
  assert.equal((await member.request<PublicUser>('GET', '/auth/me')).id, memberUser.id)
  assert.equal((await owner.request<PublicNamespace[]>('GET', '/namespaces')).filter(item => item.kind === 'personal').length, 1)
  t.diagnostic('PASS registration, rejected credentials, login and session restoration')

  await guest.request('POST', '/namespaces', 401, { name: 'Team', slug: account })
  await owner.request('POST', '/namespaces', 400, { name: 'Reserved', slug: 'settings' })
  await owner.request<PublicNamespace>('POST', '/namespaces', 201, { name: 'Team', slug: account })
  const space = await owner.request<PublicSpace>('POST', namespace + '/spaces', 201, {
    name: 'Demo', slug: 'demo', type: 'git', visibility: 'private',
  })
  assert.equal((await owner.request<PublicSpace & { canManage: boolean }>('GET', spaceUrl)).canManage, true)
  await guest.request('GET', spaceUrl, 401)
  await member.request('GET', spaceUrl, 403)
  await member.request('POST', namespace + '/members', 403, { email: ownerUser.email })
  await owner.request('POST', spaceUrl + '/members', 404, { email: memberUser.email, role: 'reader' })
  await owner.request('POST', namespace + '/members', 201, { email: memberUser.email })
  await owner.request('POST', namespace + '/members', 409, { email: memberUser.email })
  assert.deepEqual(await member.request<PublicSpace[]>('GET', namespace + '/spaces'), [])
  await owner.request('POST', spaceUrl + '/members', 201, { email: memberUser.email, role: 'reader' })
  assert.equal((await member.request<PublicSpace[]>('GET', namespace + '/spaces'))[0]?.id, space.id)
  assert.equal((await member.request<PublicSpace & { canManage: boolean }>('GET', spaceUrl)).canManage, false)
  await member.request('PATCH', spaceUrl, 403, { visibility: 'public' })
  await member.request('GET', spaceUrl + '/members', 403)
  await member.request('DELETE', spaceUrl, 403)
  t.diagnostic('PASS organization creation, private Space discovery and owner-only settings')

  const ownerToken = await owner.request<CreatedPersonalAccessToken>('POST', '/auth/tokens', 201, {
    name: 'Owner Git', scopes: ['git:read', 'git:write'],
  })
  // A token with write scope still cannot bypass a Reader's Space permission.
  const memberToken = await member.request<CreatedPersonalAccessToken>('POST', '/auth/tokens', 201, {
    name: 'Member Git', scopes: ['git:read', 'git:write'],
  })
  const source = join(root, 'owner-worktree')
  const memberClone = join(root, 'member-worktree')
  await git(['init', '--initial-branch=main', source])
  await git(['-C', source, 'remote', 'add', 'origin', remote])
  await writeFile(join(source, 'README.md'), '# Main\n')
  await git(['-C', source, 'add', '.'])
  await git(['-C', source, 'commit', '-m', 'Initial commit'])
  await git(['-C', source, 'push', '-u', 'origin', 'main'], ownerToken.token)
  const initial = await owner.request<GitRepositoryInfo>('GET', spaceUrl + '/git')
  assert.equal(initial.defaultBranch, 'main')
  assert.deepEqual(initial.branches, ['main'])
  const cloneResult = await git(['clone', remote, memberClone], memberToken.token)
  assert.doesNotMatch(cloneResult.stderr, /unable to checkout/)
  assert.equal((await git(['-C', memberClone, 'branch', '--show-current'])).stdout.trim(), 'main')
  assert.equal(await readFile(join(memberClone, 'README.md'), 'utf8'), '# Main\n')
  await writeFile(join(memberClone, 'member.txt'), 'Member commit\n')
  await git(['-C', memberClone, 'add', '.'])
  await git(['-C', memberClone, 'commit', '-m', 'Member update'])
  const push = () => git(['-C', memberClone, 'push', 'origin', 'HEAD:main'], memberToken.token)
  const denied = (error: unknown) => /403/.test((error as { stderr: string }).stderr)
  await assert.rejects(push(), denied)
  assert.equal((await owner.request<GitRepositoryInfo>('GET', spaceUrl + '/git')).commits[0]?.id, initial.commits[0]?.id)
  t.diagnostic('PASS first HTTP push, default HEAD, Reader clone and denied Reader push')

  await owner.request('PATCH', spaceUrl + '/members/' + memberUser.id, 200, { role: 'writer' })
  await push()
  await git(['-C', source, 'fetch', 'origin'], ownerToken.token)
  assert.equal((await git(['-C', source, 'show', 'origin/main:member.txt'])).stdout, 'Member commit\n')
  await owner.request('PATCH', spaceUrl + '/members/' + memberUser.id, 200, { role: 'reader' })
  await writeFile(join(memberClone, 'member.txt'), 'Must not reach the server\n')
  await git(['-C', memberClone, 'add', '.'])
  await git(['-C', memberClone, 'commit', '-m', 'Denied after downgrade'])
  await assert.rejects(push(), denied)
  await git(['-C', source, 'fetch', 'origin'], ownerToken.token)
  assert.equal((await git(['-C', source, 'show', 'origin/main:member.txt'])).stdout, 'Member commit\n')
  await git(['-C', memberClone, 'fetch', 'origin'], memberToken.token)
  t.diagnostic('PASS Writer push and immediate write denial after downgrade')

  await git(['-C', source, 'switch', '-c', 'release/stable', 'origin/main'])
  await writeFile(join(source, 'README.md'), '# Release\n')
  await git(['-C', source, 'add', '.'])
  await git(['-C', source, 'commit', '-m', 'Release content'])
  await git(['-C', source, 'push', 'origin', 'release/stable'], ownerToken.token)
  await git(['-C', source, 'tag', 'tag-only'])
  await git(['-C', source, 'push', 'origin', '--tags'], ownerToken.token)
  const defaultBranchUrl = spaceUrl + '/git/default-branch'
  await member.request('PATCH', defaultBranchUrl, 403, { branch: 'release/stable' })
  for (const branch of ['missing', 'tag-only', initial.commits[0]!.id]) {
    await owner.request('PATCH', defaultBranchUrl, 404, { branch })
    assert.equal((await owner.request<GitRepositoryInfo>('GET', spaceUrl + '/git')).defaultBranch, 'main')
  }
  await owner.request('PATCH', defaultBranchUrl, 200, { branch: 'release/stable' })
  assert.equal((await member.request<GitRepositoryInfo>('GET', spaceUrl + '/git')).defaultBranch, 'release/stable')
  const readme = await member.request<{ content: string }>('GET', spaceUrl + '/git/readme')
  assert.equal(readme.content, '# Release\n')
  const releaseClone = join(root, 'release-clone')
  await git(['clone', remote, releaseClone], memberToken.token)
  assert.equal((await git(['-C', releaseClone, 'branch', '--show-current'])).stdout.trim(), 'release/stable')
  assert.equal(await readFile(join(releaseClone, 'README.md'), 'utf8'), '# Release\n')
  t.diagnostic('PASS default branch validation and matching API / clone content')

  await owner.request('DELETE', spaceUrl + '/members/' + ownerUser.id, 409)
  await owner.request('DELETE', spaceUrl + '/members/' + memberUser.id, 204)
  await member.request('GET', spaceUrl, 403)
  await assert.rejects(git(['-C', memberClone, 'fetch', 'origin'], memberToken.token), denied)
  await assert.rejects(push(), denied)
  await owner.request('POST', spaceUrl + '/members', 201, { email: memberUser.email, role: 'writer' })
  await owner.request('DELETE', namespace + '/members/' + memberUser.id, 204)
  assert.equal((await app.db.selectFrom('space_members').select('user_id').where('space_id', '=', space.id).where('user_id', '=', memberUser.id).execute()).length, 0)
  await member.request('GET', spaceUrl, 403)
  await assert.rejects(git(['-C', memberClone, 'fetch', 'origin'], memberToken.token), denied)
  assert.equal((await member.request<PublicNamespace[]>('GET', '/namespaces')).some(item => item.slug === account), false)
  t.diagnostic('PASS Space removal and organization removal revoke private access')

  await owner.request('DELETE', '/auth/tokens/' + ownerToken.id, 204)
  const revoked = await fetch(remote + '/info/refs?service=git-upload-pack', {
    headers: { authorization: 'Basic ' + Buffer.from('git:' + ownerToken.token).toString('base64') },
    signal: AbortSignal.timeout(15_000),
  })
  await revoked.arrayBuffer()
  assert.equal(revoked.status, 401)
  await assert.rejects(git(['-C', source, 'fetch', 'origin'], ownerToken.token), (error: unknown) => /401|Authentication failed|terminal prompts disabled/.test((error as { stderr: string }).stderr))
  await owner.request('POST', '/auth/logout', 204)
  await owner.request('GET', '/auth/me', 401)
  await owner.request('POST', namespace + '/spaces', 401, { name: 'Denied', slug: 'denied', type: 'git' })
  t.diagnostic('PASS token revocation and logout')
})
