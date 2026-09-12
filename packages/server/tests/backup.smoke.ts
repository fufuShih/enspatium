import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { appendFile, lstat, mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises'
import { request } from 'node:https'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv, promisify } from 'node:util'
import { expect, test } from 'vitest'

const exec = promisify(execFile)
const repository = fileURLToPath(new URL('../../../', import.meta.url))

test('a stopped-writer backup restores old Git refs and Object versions into an independent HTTPS deployment', async () => {
  const source = process.env.DEPLOYMENT_URL
  assert.equal(source, 'https://localhost:18443', 'Use only the disposable enspatium-smoke deployment.')
  const root = await mkdtemp(join(tmpdir(), 'enspatium-backup-test-'))
  const snapshot = join(root, 'snapshot')
  const project = 'ensp-recovery-test-' + randomUUID().replaceAll('-', '').slice(0, 12)
  const envFile = join(root, 'target.env')
  const sourceEnvFile = join(repository, 'deploy/.env.smoke')
  const sourceCaFile = join(repository, 'deploy/.env.smoke-ca.pem')
  let ca = await readFile(sourceCaFile)
  let origin = source
  let cookie = ''
  let restored = false
  const targetCompose = ['compose', '--env-file', envFile, '-p', project, '-f', join(snapshot, 'compose.yaml'), '-f', join(snapshot, 'images.json')]
  async function http(method: string, path: string, status = 200, body?: unknown) {
    const bytes = body === undefined ? undefined : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
    return new Promise<Buffer>((accept, reject) => {
      const req = request(new URL(path, origin), { method, ca, timeout: 15_000, headers: {
        ...(cookie ? { cookie } : {}), ...(bytes ? { 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json', 'content-length': bytes.length } : {}),
      } }, response => {
        const parts: Buffer[] = []
        response.on('data', part => parts.push(Buffer.from(part)))
        response.on('error', reject)
        response.on('end', () => {
          try {
            assert.equal(response.statusCode, status, method + ' ' + path + ': unexpected status')
            const nextCookie = response.headers['set-cookie']?.[0]
            if (nextCookie) cookie = nextCookie.split(';')[0]!
            accept(Buffer.concat(parts))
          } catch (error) { reject(error) }
        })
      })
      req.on('timeout', () => req.destroy(new Error('Backup test HTTP request timed out')))
      req.on('error', reject)
      req.end(bytes)
    })
  }
  async function json<T>(method: string, path: string, status = 200, body?: unknown): Promise<T> {
    return JSON.parse((await http(method, path, status, body)).toString('utf8')) as T
  }
  async function tool(args: string[]) {
    try {
      const result = await exec(process.execPath, ['deploy/backup.mjs', ...args], { cwd: repository, timeout: 10 * 60 * 1000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 })
      console.info(result.stderr.trim())
      return JSON.parse(result.stdout) as { status: string; verification?: { gitRepositories: number; objectVersions: number; hashesChecked: number } }
    } catch (error) {
      // Our operator tool emits sanitized diagnostics only; don't include the
      // child's full Error (which can contain arguments/environment).
      throw new Error(String((error as { stderr?: string }).stderr || 'Backup test tool failed'))
    }
  }
  const gitEnv: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  await writeFile(join(root, 'gitconfig'), '')
  Object.assign(gitEnv, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, 'gitconfig'), GIT_TERMINAL_PROMPT: '0' })
  async function git(args: string[], cwd = root) {
    try { return (await exec('git', ['-c', 'user.name=Backup test', '-c', 'user.email=backup@example.test', '-c', 'commit.gpgsign=false', ...args], { cwd, env: gitEnv, timeout: 30_000, windowsHide: true })).stdout.trim() }
    catch { throw new Error('Backup test Git command failed: ' + args[0]) }
  }
  try {
    await http('GET', '/api/health/db')
    const user = { email: 'backup-' + randomUUID() + '@example.test', displayName: 'Backup test', password: randomBytes(24).toString('hex') }
    await http('POST', '/api/users', 201, user)
    await http('POST', '/api/auth/login', 200, user)
    const namespaces = await json<{ slug: string }[]>('GET', '/api/namespaces')
    const account = namespaces[0]!.slug
    const base = `/api/namespaces/${account}/spaces`
    await http('POST', base, 201, { name: 'Backup Git', slug: 'backup-git', type: 'git' })
    await http('POST', base, 201, { name: 'Backup objects', slug: 'backup-objects', type: 'object' })
    const objectPath = base + '/backup-objects/objects/docs%2Fversion.txt'
    const first = await json<{ versionId: string; spaceId: string }>('PUT', objectPath + '?expectedVersion=none', 201, 'First saved version')
    const second = await json<{ versionId: string }>('PUT', objectPath + '?expectedVersion=' + first.versionId, 201, 'Second saved version')
    const token = await json<{ token: string }>('POST', '/api/auth/tokens', 201, { name: 'Backup test', scopes: ['git:read', 'git:write'] })
    Object.assign(gitEnv, {
      GIT_CONFIG_COUNT: '4', GIT_CONFIG_KEY_0: 'http.sslBackend', GIT_CONFIG_VALUE_0: 'openssl',
      GIT_CONFIG_KEY_1: 'http.sslCAInfo', GIT_CONFIG_VALUE_1: sourceCaFile,
      GIT_CONFIG_KEY_2: 'http.extraHeader', GIT_CONFIG_VALUE_2: 'Authorization: Basic ' + Buffer.from('git:' + token.token).toString('base64'),
      GIT_CONFIG_KEY_3: 'credential.helper', GIT_CONFIG_VALUE_3: '',
    })
    await git(['init', '--initial-branch=main'])
    await writeFile(join(root, 'README.md'), '# Saved in backup\n')
    await git(['add', 'README.md'])
    await git(['commit', '-m', 'Saved commit'])
    await git(['tag', 'saved-v1'])
    const remotePath = `/api/git/${account}/backup-git.git`
    await git(['remote', 'add', 'origin', source + remotePath])
    await git(['push', 'origin', 'main', '--tags'])
    const savedCommit = await git(['rev-parse', 'HEAD'])

    expect((await tool(['create', '--env-file', sourceEnvFile, '--project', 'enspatium-smoke', '--output', snapshot])).status).toBe('created')
    await http('GET', '/api/auth/me') // original session and service survived backup
    expect((await http('GET', objectPath)).toString()).toBe('Second saved version')
    // Mutate the source after the snapshot; restored data must stay at backup time.
    await http('PUT', objectPath + '?expectedVersion=' + second.versionId, 201, 'Newer source bytes')
    await writeFile(join(root, 'README.md'), '# After backup\n')
    await git(['add', 'README.md'])
    await git(['commit', '-m', 'After backup'])
    await git(['push', 'origin', 'main'])

    const tar = join(snapshot, 'content.tar.gz')
    const size = (await lstat(tar)).size
    await appendFile(tar, 'corruption')
    await expect(tool(['verify', '--env-file', sourceEnvFile, '--backup', snapshot])).rejects.toThrow('checksum')
    await truncate(tar, size)
    await expect(tool(['restore', '--env-file', sourceEnvFile, '--backup', snapshot, '--project', 'enspatium-smoke'])).rejects.toThrow('never the source')
    const reservedProject = project + '-hold'
    const reservedVolume = reservedProject + '_content'
    expect((await exec('docker', ['volume', 'create', reservedVolume], { windowsHide: true })).stdout.trim()).toBe(reservedVolume)
    try {
      await expect(tool(['restore', '--env-file', sourceEnvFile, '--backup', snapshot, '--project', reservedProject])).rejects.toThrow('volume already exists')
      expect((await exec('docker', ['volume', 'inspect', '--format', '{{.Name}}', reservedVolume], { windowsHide: true })).stdout.trim()).toBe(reservedVolume)
    } finally { await exec('docker', ['volume', 'rm', reservedVolume], { windowsHide: true }) }

    const check = await tool(['verify', '--env-file', sourceEnvFile, '--backup', snapshot])
    expect(check.status).toBe('verified')
    expect(check.verification!.gitRepositories).toBeGreaterThan(0)
    expect(check.verification!.objectVersions).toBeGreaterThanOrEqual(2)
    expect(check.verification!.hashesChecked).toBeGreaterThanOrEqual(2)
    expect((await exec('docker', ['volume', 'ls', '-q', '--filter', 'name=^ensp-verify-'], { windowsHide: true })).stdout.trim()).toBe('')

    const targetEnv = { ...parseEnv(await readFile(sourceEnvFile, 'utf8')), SITE_ADDRESS: 'https://localhost', HTTP_BIND: '127.0.0.1', HTTP_PORT: '0', HTTPS_PORT: '0' }
    await writeFile(envFile, Object.entries(targetEnv).map(([key, value]) => key + '=' + value).join('\n'), { mode: 0o600 })
    expect((await tool(['restore', '--env-file', envFile, '--backup', snapshot, '--project', project])).status).toBe('restored')
    restored = true
    await expect(tool(['restore', '--env-file', envFile, '--backup', snapshot, '--project', project])).rejects.toThrow('already has resources')
    await exec('docker', [...targetCompose, 'up', '-d', '--no-build', '--wait', 'db'], { cwd: repository, timeout: 120_000, windowsHide: true })
    // Corrupt only our restored test version, retaining its length and DB row.
    // The verifier must read bytes, not just count files or trust the manifest.
    const versionPath = '/data/' + first.spaceId + '/' + first.versionId
    assert.match(versionPath, /^\/data\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/)
    const overwrite = (bytes: string) => exec('docker', [...targetCompose, 'run', '--rm', '--no-deps', '-T', 'server', 'node', '-e',
      'require("node:fs").writeFileSync(process.argv[1], process.argv[2])', versionPath, bytes], { cwd: repository, timeout: 30_000, windowsHide: true })
    await overwrite('First saved versioX')
    await expect(exec('docker', [...targetCompose, 'run', '--rm', '--no-deps', '-T', 'server', 'node', 'packages/server/dist/scripts/verify-backup.js'], { cwd: repository, timeout: 60_000, windowsHide: true }))
      .rejects.toMatchObject({ stderr: expect.stringContaining('OBJECT_CHECKSUM_MISMATCH') })
    await overwrite('First saved version')
    await exec('docker', [...targetCompose, 'up', '-d', '--no-build', '--wait'], { cwd: repository, timeout: 120_000, windowsHide: true })
    const address = (await exec('docker', [...targetCompose, 'port', 'web', '443'], { cwd: repository, windowsHide: true })).stdout.trim()
    const port = address.split(':').at(-1)!
    assert.match(port, /^\d+$/)
    origin = 'https://localhost:' + port
    const targetCaFile = join(root, 'target-ca.pem')
    await exec('docker', [...targetCompose, 'cp', 'web:/data/caddy/pki/authorities/local/root.crt', targetCaFile], { cwd: repository, windowsHide: true })
    ca = await readFile(targetCaFile)
    cookie = ''
    await http('POST', '/api/auth/login', 200, user)
    expect((await http('GET', objectPath)).toString()).toBe('Second saved version')
    expect((await http('GET', base + '/backup-objects/object-versions/content?key=docs%2Fversion.txt&versionId=' + first.versionId)).toString()).toBe('First saved version')
    gitEnv.GIT_CONFIG_VALUE_1 = targetCaFile
    await git(['clone', origin + remotePath, join(root, 'restored-clone')])
    expect(await git(['rev-parse', 'HEAD'], join(root, 'restored-clone'))).toBe(savedCommit)
    expect(await git(['rev-parse', 'refs/tags/saved-v1'], join(root, 'restored-clone'))).toBe(savedCommit)
    expect(await readFile(join(root, 'restored-clone/README.md'), 'utf8')).toBe('# Saved in backup\n')
    origin = source
    ca = await readFile(sourceCaFile)
    cookie = ''
    await http('POST', '/api/auth/login', 200, user)
    expect((await http('GET', objectPath)).toString()).toBe('Newer source bytes')
  } finally {
    if (restored) await exec('docker', [...targetCompose, 'down', '--volumes', '--remove-orphans'], { cwd: repository, timeout: 120_000, windowsHide: true })
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert.ok(root.startsWith(join(tmpdir(), 'enspatium-backup-test-')))
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})
