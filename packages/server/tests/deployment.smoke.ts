import { test, expect } from 'vitest'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:https'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const repo = fileURLToPath(new URL('../../../', import.meta.url))

// Explicitly opt in to a disposable local deployment. Never target a public site.
test('production images serve HTTPS, authenticate, persist data and support real Git through the proxy', async () => {
  const origin = process.env.DEPLOYMENT_URL
  assert.ok(origin, 'Set DEPLOYMENT_URL to the isolated local HTTPS deployment.')
  const url = new URL(origin)
  assert.equal(url.protocol, 'https:')
  assert.equal(url.hostname, 'localhost')
  const caFile = resolve(repo, 'deploy/.env.smoke-ca.pem')
  const ca = await readFile(caFile)
  const root = await mkdtemp(join(tmpdir(), 'enspatium-deployment-'))
  let cookie = ''
  async function http(method: string, path: string, status: number, body?: unknown) {
    const bytes = body === undefined ? undefined : JSON.stringify(body)
    return new Promise<{ text: string; headers: import('node:http').IncomingHttpHeaders }>((accept, reject) => {
      const req = request(new URL(path, origin), { method, ca,
        headers: { ...(bytes ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(bytes) } : {}), ...(cookie ? { cookie } : {}) },
        timeout: 15_000,
      }, res => {
        const parts: Buffer[] = []
        res.on('data', part => parts.push(Buffer.from(part)))
        res.on('error', reject)
        res.on('end', () => {
          try {
            assert.equal(res.statusCode, status, `${method} ${path}: unexpected status`)
            accept({ text: Buffer.concat(parts).toString('utf8'), headers: res.headers })
          } catch (error) { reject(error) }
        })
      })
      req.on('timeout', () => req.destroy(new Error('Deployment request timed out')))
      req.on('error', reject)
      req.end(bytes)
    })
  }
  async function json<T>(method: string, path: string, status: number, body?: unknown) {
    return JSON.parse((await http(method, path, status, body)).text) as T
  }
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key]
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, 'gitconfig'), GIT_TERMINAL_PROMPT: '0' })
  await writeFile(join(root, 'gitconfig'), '')
  async function git(args: string[], cwd = root) {
    try { return (await exec('git', args, { cwd, env, timeout: 30_000, windowsHide: true })).stdout.trim() }
    catch { throw new Error(`Deployment Git command failed: ${args[0]}`) } // Credentials must not appear in diagnostics.
  }
  try {
    await http('GET', '/api/health/db', 200)
    const index = await http('GET', '/', 200)
    expect(index.headers['content-type']).toContain('text/html')
    const deep = await http('GET', '/app/ebook/nonexistent/book/test', 200)
    expect(deep.text).toBe(index.text)
    const asset = index.text.match(/src="([^"]+\.js)"/)?.[1]
    assert.ok(asset, 'Built entry script is missing')
    expect((await http('GET', asset, 200)).headers['content-type']).toMatch(/javascript/)
    expect((await http('GET', '/api/not-a-route', 404)).headers['content-type']).toContain('application/json')
    const user = { email: `deployment-${randomUUID()}@example.test`, displayName: 'Deployment check', password: randomBytes(24).toString('hex') }
    const createdUser = await json<{ id: string }>('POST', '/api/users', 201, user)
    const login = await http('POST', '/api/auth/login', 200, user)
    const setCookie = login.headers['set-cookie']?.[0]
    assert.ok(setCookie && /; Secure/i.test(setCookie) && /; HttpOnly/i.test(setCookie) && /; SameSite=Strict/i.test(setCookie), 'Expected secure session cookie')
    cookie = setCookie.split(';')[0]!
    const namespaces = await json<{ slug: string }[]>('GET', '/api/namespaces', 200)
    const account = namespaces[0]!.slug
    const base = `/api/namespaces/${account}/spaces`
    const space = await json<{ id: string }>('POST', base, 201, { name: 'Deployment Git', slug: 'deployment-git', type: 'git' })
    const token = await json<{ token: string }>('POST', '/api/auth/tokens', 201, { name: 'Deployment check', scopes: ['git:read', 'git:write'] })
    Object.assign(env, {
      GIT_CONFIG_COUNT: '4',
      GIT_CONFIG_KEY_0: 'http.sslBackend', GIT_CONFIG_VALUE_0: 'openssl',
      GIT_CONFIG_KEY_1: 'http.sslCAInfo', GIT_CONFIG_VALUE_1: caFile,
      GIT_CONFIG_KEY_2: 'http.extraHeader', GIT_CONFIG_VALUE_2: `Authorization: Basic ${Buffer.from('test:' + token.token).toString('base64')}`,
      GIT_CONFIG_KEY_3: 'credential.helper', GIT_CONFIG_VALUE_3: '',
    })
    await git(['init', '--initial-branch=main'])
    await git(['config', 'user.name', 'Deployment check'])
    await git(['config', 'user.email', 'deployment@example.test'])
    await writeFile(join(root, 'README.md'), '# Deployment check\n')
    await git(['add', 'README.md'])
    await git(['commit', '-m', 'Initial contents'])
    await git(['tag', '-a', 'release/v1', '-m', 'First release'])
    const cloneUrl = `${origin}/api/git/${account}/deployment-git.git`
    await git(['remote', 'add', 'origin', cloneUrl])
    await git(['push', 'origin', 'main', '--tags'])
    const firstCommit = await git(['rev-parse', 'HEAD'])
    await writeFile(join(root, 'second.txt'), 'Fast-forward push\n')
    await git(['add', 'second.txt'])
    await git(['commit', '-m', 'Fast-forward contents'])
    await git(['push', 'origin', 'main'])
    const commit = await git(['rev-parse', 'HEAD'])
    for (const args of [['push', '--force', 'origin', firstCommit + ':main'], ['push', 'origin', '--delete', 'main']]) {
      let rejected = false
      try { await exec('git', args, { cwd: root, env, timeout: 30_000, windowsHide: true }) }
      catch (error) { rejected = String((error as { stderr?: string }).stderr).includes('The default branch is protected') }
      expect(rejected, 'The remote must reject changes to the protected default branch').toBe(true)
    }
    const compose = ['compose', '--env-file', 'deploy/.env.smoke', '-p', 'enspatium-smoke', '-f', 'deploy/compose.yaml']
    // Elevate only this freshly generated disposable test account. The real
    // production bootstrap and account management have separate acceptance tests.
    assert.match(createdUser.id, /^[0-9a-f-]{36}$/)
    await exec('docker', [...compose, 'exec', '-T', 'db', 'psql', '-U', 'enspatium', '-d', 'enspatium', '-v', 'ON_ERROR_STOP=1', '-c', `UPDATE users SET is_admin = true WHERE id = '${createdUser.id}'`], { cwd: repo, timeout: 15_000, windowsHide: true })
    expect(await json('GET', '/api/admin/operations', 200)).toMatchObject({ databaseReady: true, storage: { available: true } })
    await http('POST', '/api/admin/git/maintenance', 202, { spaceId: space.id })
    type JobStatus = { job: { phase: string; status: string; auditRecorded: boolean; message: string } | null }
    await expect.poll(async () => (await json<JobStatus>('GET', '/api/admin/git/maintenance', 200)).job?.phase, { timeout: 30_000 }).toBe('finished')
    expect((await json<JobStatus>('GET', '/api/admin/git/maintenance', 200)).job).toMatchObject({ status: 'completed', auditRecorded: true })
    // Recreate containers while retaining named volumes; the migration must remain repeatable.
    await exec('docker', [...compose, 'up', '-d', '--force-recreate', '--wait'], { cwd: repo, timeout: 120_000, windowsHide: true })
    await http('GET', '/api/auth/me', 200)
    expect(await json('GET', '/api/admin/git/maintenance', 200)).toEqual({ job: null })
    const events = await json<{ action: string; metadata: { status?: string } }[]>('GET', base + '/deployment-git/audit-events', 200)
    expect(events.some(event => event.action === 'git.maintained' && event.metadata.status === 'completed')).toBe(true)
    expect(events.filter(event => event.action === 'git.pushed')).toHaveLength(2)
    await git(['clone', cloneUrl, 'clone'])
    expect(await git(['rev-parse', 'HEAD'], join(root, 'clone'))).toBe(commit)
    expect(await readFile(join(root, 'clone/README.md'), 'utf8')).toBe('# Deployment check\n')
    expect(await git(['rev-parse', 'refs/tags/release/v1^{commit}'], join(root, 'clone'))).toBe(firstCommit)
    const gitBase = base + '/deployment-git/git'
    expect(await json('GET', gitBase + '/refs?type=branch', 200)).toMatchObject({ total: 1, items: [{ name: 'main', commit: { id: commit, message: 'Fast-forward contents' } }] })
    expect(await json('GET', gitBase + '/refs?type=tag', 200)).toMatchObject({ total: 1, items: [{ name: 'release/v1', commit: { id: firstCommit, message: 'Initial contents' } }] })
    expect(await json('GET', gitBase + '/readme?' + new URLSearchParams({ ref: 'refs/tags/release/v1' }), 200)).toMatchObject({ commitId: firstCommit, content: '# Deployment check\n' })
    const comparison = await json<{ from: { commitId: string }; to: { commitId: string }; patch: string }>('GET', gitBase + '/diff?' + new URLSearchParams({ from: 'refs/tags/release/v1', to: 'refs/heads/main' }), 200)
    expect(comparison.from.commitId).toBe(firstCommit)
    expect(comparison.to.commitId).toBe(commit)
    expect(comparison.patch).toContain('+Fast-forward push')
    expect((await http('GET', `/${account}/deployment-git?view=compare`, 200)).text).toBe(index.text)
    // The image must preserve its non-root storage ownership after recreation.
    const identity = await exec('docker', [...compose, 'exec', '-T', 'server', 'id', '-u'], { cwd: repo, windowsHide: true })
    expect(identity.stdout.trim()).not.toBe('0')
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert.ok(root.startsWith(join(tmpdir(), 'enspatium-deployment-')))
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})
