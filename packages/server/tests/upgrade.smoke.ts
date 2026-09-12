import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:https'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv, promisify } from 'node:util'
import { expect, test } from 'vitest'

const exec = promisify(execFile)
const repository = fileURLToPath(new URL('../../../', import.meta.url))
const uuid = /^[0-9a-f-]{36}$/
const imageId = /^sha256:[0-9a-f]{64}$/

// Only fresh projects, loopback listeners and named volumes created by this
// test. Never upgrade the operator's normal or smoke deployment in place.
test('a release upgrade preserves Git and Object data, and a failed migration recovers from the old snapshot', async () => {
  assert.equal(process.env.UPGRADE_TEST, 'true', 'Set UPGRADE_TEST=true and provide the two release image pairs.')
  const root = await mkdtemp(join(tmpdir(), 'enspatium-upgrade-test-'))
  const project = 'ensp-upgrade-' + randomUUID().replaceAll('-', '').slice(0, 12)
  const recovery = project + '-recovery'
  const envFile = join(root, 'deployment.env')
  const snapshot = join(root, 'snapshot')
  const previousFile = join(root, 'previous.json')
  const candidateFile = join(root, 'candidate.json')
  const failureFile = join(root, 'failure.json')
  const composeFile = join(repository, 'compose.yaml')
  let sourceCreated = false
  let recoveryCreated = false
  let origin = ''
  let ca = Buffer.alloc(0)
  let cookie = ''
  let currentCaFile = ''
  let activeCompose: string[] = []
  const progress = (message: string) => console.info('[upgrade] ' + message)
  async function docker(args: string[], timeout = 120_000) {
    try { return (await exec('docker', args, { cwd: repository, timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024 })).stdout.trim() }
    catch { throw new Error('Upgrade test Docker operation failed: ' + args[0]) }
  }
  const compose = (name: string, ...files: string[]) => ['compose', '--env-file', envFile, '-p', name, ...files.flatMap(file => ['-f', file])]
  const sourceCompose = (override: string) => compose(project, composeFile, override)
  const recoveryCompose = () => compose(recovery, join(snapshot, 'compose.yaml'), join(snapshot, 'images.json'))
  async function tool(args: string[]) {
    try {
      const result = await exec(process.execPath, ['deploy/backup.mjs', ...args], { cwd: repository, timeout: 600_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 })
      return JSON.parse(result.stdout) as { status: string }
    } catch (error) { throw new Error(String((error as { stderr?: string }).stderr || 'Upgrade backup operation failed')) }
  }
  async function http(method: string, path: string, status = 200, body?: unknown) {
    const bytes = body === undefined ? undefined : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
    return new Promise<Buffer>((accept, reject) => {
      const req = request(new URL(path, origin), { method, ca, timeout: 15_000, headers: {
        ...(cookie ? { cookie } : {}), ...(bytes ? { 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json', 'content-length': bytes.length } : {}),
      } }, response => {
        const chunks: Buffer[] = []
        response.on('data', chunk => chunks.push(Buffer.from(chunk)))
        response.on('error', reject)
        response.on('end', () => {
          try {
            assert.equal(response.statusCode, status, method + ' ' + path + ': unexpected status')
            const next = response.headers['set-cookie']?.[0]
            if (next) cookie = next.split(';')[0]!
            accept(Buffer.concat(chunks))
          } catch (error) { reject(error) }
        })
      })
      req.on('timeout', () => req.destroy(new Error('Upgrade request timed out')))
      req.on('error', reject)
      req.end(bytes)
    })
  }
  const json = async <T>(method: string, path: string, status = 200, body?: unknown) => JSON.parse((await http(method, path, status, body)).toString()) as T
  const gitEnv: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  Object.assign(gitEnv, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, 'gitconfig'), GIT_TERMINAL_PROMPT: '0' })
  async function git(args: string[], cwd = root) {
    try { return (await exec('git', ['-c', 'user.name=Upgrade test', '-c', 'user.email=upgrade@example.test', '-c', 'commit.gpgsign=false', ...args], { cwd, env: gitEnv, timeout: 30_000, windowsHide: true })).stdout.trim() }
    catch { throw new Error('Upgrade test Git command failed: ' + args[0]) }
  }
  async function connect(command: string[], label: string) {
    activeCompose = command
    const port = (await docker([...command, 'port', 'web', '443'])).split(':').at(-1)!
    assert.match(port, /^\d+$/)
    origin = 'https://localhost:' + port
    currentCaFile = join(root, label + '-ca.pem')
    await docker([...command, 'cp', 'web:/data/caddy/pki/authorities/local/root.crt', currentCaFile])
    ca = await readFile(currentCaFile)
    gitEnv.GIT_CONFIG_VALUE_1 = currentCaFile
  }
  async function inspectService(command: string[], service: string) {
    const id = await docker([...command, 'ps', '-a', '-q', service])
    assert.match(id, /^[0-9a-f]{64}$/)
    return JSON.parse(await docker(['inspect', '--format', '{"image":"{{.Image}}","running":{{.State.Running}},"exitCode":{{.State.ExitCode}}}', id])) as { image: string; running: boolean; exitCode: number }
  }
  try {
    const images: Record<string, string> = {}
    for (const key of ['UPGRADE_FROM_SERVER_IMAGE', 'UPGRADE_FROM_WEB_IMAGE', 'UPGRADE_TO_SERVER_IMAGE', 'UPGRADE_TO_WEB_IMAGE']) {
      const name = process.env[key]
      assert.ok(name && !name.startsWith('-'), 'Provide ' + key + ' as a local image name or ID.')
      const id = await docker(['image', 'inspect', '--format', '{{.Id}}', name])
      assert.match(id, imageId)
      images[key] = id
    }
    assert.ok(images.UPGRADE_FROM_SERVER_IMAGE !== images.UPGRADE_TO_SERVER_IMAGE || images.UPGRADE_FROM_WEB_IMAGE !== images.UPGRADE_TO_WEB_IMAGE, 'Upgrade must change at least one application image.')
    const dbImage = await docker(['image', 'inspect', '--format', '{{.Id}}', 'postgres:17-bookworm'])
    assert.match(dbImage, imageId)
    for (const name of [project, recovery]) {
      expect(await docker(['ps', '-a', '-q', '--filter', 'label=com.docker.compose.project=' + name])).toBe('')
      expect(await docker(['volume', 'ls', '-q', '--filter', 'name=^' + name + '_'])).toBe('')
      expect(await docker(['network', 'ls', '-q', '--filter', 'name=^' + name + '_'])).toBe('')
    }
    const config = { ...parseEnv(await readFile(join(repository, 'deploy/.env.smoke'), 'utf8')), SITE_ADDRESS: 'https://localhost', HTTP_BIND: '127.0.0.1', HTTP_PORT: '0', HTTPS_PORT: '0', REGISTRATION_ENABLED: 'true' }
    await writeFile(envFile, Object.entries(config).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n'), { mode: 0o600 })
    await writeFile(join(root, 'gitconfig'), '')
    const override = (server: string, web: string) => ({ services: {
      server: { image: server, pull_policy: 'never' }, migrate: { image: server, pull_policy: 'never' },
      web: { image: web, pull_policy: 'never' }, db: { image: dbImage, pull_policy: 'never' },
    } })
    await writeFile(previousFile, JSON.stringify(override(images.UPGRADE_FROM_SERVER_IMAGE!, images.UPGRADE_FROM_WEB_IMAGE!)))
    await writeFile(candidateFile, JSON.stringify(override(images.UPGRADE_TO_SERVER_IMAGE!, images.UPGRADE_TO_WEB_IMAGE!)))
    sourceCreated = true
    progress('Starting the previous release in a fresh, isolated deployment.')
    await docker([...sourceCompose(previousFile), 'up', '-d', '--no-build', '--wait'])
    await connect(sourceCompose(previousFile), 'previous')
    const user = { email: 'upgrade-' + randomUUID() + '@example.test', displayName: 'Upgrade test', password: randomBytes(24).toString('hex') }
    const createdUser = await json<{ id: string }>('POST', '/api/users', 201, user)
    assert.match(createdUser.id, uuid)
    await http('POST', '/api/auth/login', 200, user)
    const namespaces = await json<{ slug: string }[]>('GET', '/api/namespaces')
    const account = namespaces[0]!.slug
    const base = `/api/namespaces/${account}/spaces`
    const space = await json<{ id: string }>('POST', base, 201, { name: 'Upgrade Git', slug: 'upgrade-git', type: 'git' })
    assert.match(space.id, uuid)
    await http('POST', base, 201, { name: 'Upgrade objects', slug: 'upgrade-objects', type: 'object' })
    const object = base + '/upgrade-objects/objects/version.txt'
    const first = await json<{ versionId: string }>('PUT', object + '?expectedVersion=none', 201, 'Version before upgrade')
    const second = await json<{ versionId: string }>('PUT', object + '?expectedVersion=' + first.versionId, 201, 'Current before upgrade')
    const token = await json<{ token: string }>('POST', '/api/auth/tokens', 201, { name: 'Upgrade token', scopes: ['git:read', 'git:write'] })
    Object.assign(gitEnv, {
      GIT_CONFIG_COUNT: '4', GIT_CONFIG_KEY_0: 'http.sslBackend', GIT_CONFIG_VALUE_0: 'openssl',
      GIT_CONFIG_KEY_1: 'http.sslCAInfo', GIT_CONFIG_VALUE_1: currentCaFile,
      GIT_CONFIG_KEY_2: 'http.extraHeader', GIT_CONFIG_VALUE_2: 'Authorization: Basic ' + Buffer.from('git:' + token.token).toString('base64'),
      GIT_CONFIG_KEY_3: 'credential.helper', GIT_CONFIG_VALUE_3: '',
    })
    await git(['init', '--initial-branch=main'])
    await writeFile(join(root, 'README.md'), '# Before upgrade\n')
    await git(['add', 'README.md'])
    await git(['commit', '-m', 'Before upgrade'])
    await git(['tag', 'before-upgrade'])
    const remote = `/api/git/${account}/upgrade-git.git`
    await git(['push', origin + remote, 'main', '--tags'])
    const before = await git(['rev-parse', 'HEAD'])
    await docker([...activeCompose, 'exec', '-T', 'db', 'psql', '-U', 'enspatium', '-d', 'enspatium', '-v', 'ON_ERROR_STOP=1', '-c', `UPDATE users SET is_admin = true WHERE id = '${createdUser.id}'`])
    progress('Taking and verifying the previous release snapshot.')
    expect((await tool(['create', '--env-file', envFile, '--project', project, '--output', snapshot])).status).toBe('created')
    expect((await tool(['verify', '--env-file', envFile, '--backup', snapshot])).status).toBe('verified')
    progress('Upgrading both application images with the existing database and content volumes.')
    await docker([...activeCompose, 'stop', '--timeout', '360', 'web', 'server'], 390_000)
    await docker([...sourceCompose(candidateFile), 'up', '-d', '--no-build', '--wait'])
    await connect(sourceCompose(candidateFile), 'candidate')
    expect((await inspectService(activeCompose, 'server')).image).toBe(images.UPGRADE_TO_SERVER_IMAGE)
    expect((await inspectService(activeCompose, 'web')).image).toBe(images.UPGRADE_TO_WEB_IMAGE)
    expect((await inspectService(activeCompose, 'migrate')).exitCode).toBe(0)
    await http('GET', '/api/auth/me') // the existing session survives replacement
    await http('POST', '/api/auth/login', 200, user)
    await http('GET', '/api/admin/operations')
    expect((await http('GET', `/${account}/upgrade-git`)).toString()).toContain('<!doctype html>')
    expect((await http('GET', object)).toString()).toBe('Current before upgrade')
    expect((await http('GET', base + '/upgrade-objects/object-versions/content?key=version.txt&versionId=' + first.versionId)).toString()).toBe('Version before upgrade')
    await git(['clone', origin + remote, join(root, 'upgraded-clone')])
    expect(await git(['rev-parse', 'HEAD'], join(root, 'upgraded-clone'))).toBe(before)
    expect(await git(['rev-parse', 'refs/tags/before-upgrade'], join(root, 'upgraded-clone'))).toBe(before)
    await writeFile(join(root, 'README.md'), '# After upgrade\n')
    await git(['add', 'README.md'])
    await git(['commit', '-m', 'After upgrade'])
    await git(['push', origin + remote, 'main'])
    const after = await git(['rev-parse', 'HEAD'])
    await git(['pull', '--ff-only'], join(root, 'upgraded-clone'))
    expect(await git(['rev-parse', 'HEAD'], join(root, 'upgraded-clone'))).toBe(after)
    expect(await readFile(join(root, 'upgraded-clone', 'README.md'), 'utf8')).toBe('# After upgrade\n')
    await http('PUT', object + '?expectedVersion=' + second.versionId, 201, 'Newer candidate data')
    expect((await http('GET', object)).toString()).toBe('Newer candidate data')
    expect(await json('POST', '/api/admin/storage/check', 200, { deep: true })).toMatchObject({ status: 'ok', complete: true })

    progress('Injecting a migration failure after a schema change; application traffic must stay stopped.')
    await docker([...activeCompose, 'stop', '--timeout', '360', 'web', 'server'], 390_000)
    // An intentionally failing one-shot command, not a production migration.
    // It models a release whose earlier schema changes committed before failure.
    const failMigration = "import { Client } from 'pg'; const db = new Client({connectionString:process.env.DATABASE_URL}); await db.connect(); await db.query('CREATE TABLE upgrade_failure_probe (id integer)'); await db.end(); process.exit(42)"
    await writeFile(failureFile, JSON.stringify({ services: { migrate: { working_dir: '/app/packages/server', command: ['node', '--input-type=module', '-e', failMigration] } } }))
    await expect(docker([...activeCompose, '-f', failureFile, 'up', '-d', '--no-build', '--wait'])).rejects.toThrow('Docker operation failed')
    expect(await inspectService(activeCompose, 'migrate')).toMatchObject({ running: false, exitCode: 42 })
    expect((await inspectService(activeCompose, 'server')).running).toBe(false)
    expect((await inspectService(activeCompose, 'web')).running).toBe(false)
    progress('Recovering the pre-upgrade images and snapshot into another new deployment.')
    expect((await tool(['restore', '--env-file', envFile, '--backup', snapshot, '--project', recovery])).status).toBe('restored')
    recoveryCreated = true
    await docker([...recoveryCompose(), 'up', '-d', '--no-build', '--wait'])
    await connect(recoveryCompose(), 'recovered')
    expect((await inspectService(activeCompose, 'server')).image).toBe(images.UPGRADE_FROM_SERVER_IMAGE)
    expect((await inspectService(activeCompose, 'web')).image).toBe(images.UPGRADE_FROM_WEB_IMAGE)
    cookie = ''
    await http('POST', '/api/auth/login', 200, user)
    expect((await http('GET', object)).toString()).toBe('Current before upgrade')
    expect((await http('GET', base + '/upgrade-objects/object-versions/content?key=version.txt&versionId=' + first.versionId)).toString()).toBe('Version before upgrade')
    await git(['clone', origin + remote, join(root, 'recovered-clone')])
    expect(await git(['rev-parse', 'HEAD'], join(root, 'recovered-clone'))).toBe(before)
    expect(await git(['rev-parse', 'refs/tags/before-upgrade'], join(root, 'recovered-clone'))).toBe(before)
    expect(await docker([...activeCompose, 'exec', '-T', 'db', 'psql', '-U', 'enspatium', '-d', 'enspatium', '-Atc', "SELECT to_regclass('public.upgrade_failure_probe') IS NULL"])).toBe('t')
    // Recovery did not rewrite the failed deployment's newer history or schema.
    expect(await docker([...sourceCompose(candidateFile), 'exec', '-T', 'db', 'psql', '-U', 'enspatium', '-d', 'enspatium', '-Atc', "SELECT to_regclass('public.upgrade_failure_probe') IS NOT NULL"])).toBe('t')
    expect(await docker(['run', '--rm', '--network', 'none', '--read-only', '--mount', `type=volume,source=${project}_content,target=/data,readonly`, '--entrypoint', 'git', images.UPGRADE_TO_SERVER_IMAGE!, '--git-dir', '/data/' + space.id, 'rev-parse', 'refs/heads/main'])).toBe(after)
    progress('Upgrade, migration failure isolation and snapshot recovery verified.')
  } finally {
    assert.match(project, /^ensp-upgrade-[0-9a-f]{12}$/)
    if (recoveryCreated) await docker([...recoveryCompose(), 'down', '--volumes', '--remove-orphans'])
    if (sourceCreated) await docker([...sourceCompose(previousFile), 'down', '--volumes', '--remove-orphans'])
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert.ok(root.startsWith(join(tmpdir(), 'enspatium-upgrade-test-')))
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})
