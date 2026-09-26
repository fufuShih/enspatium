import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:https'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { Static } from '@sinclair/typebox'
import { expect, test } from 'vitest'
import { JobDetailSchema } from '../src/routes/types/jobs.types.js'

const exec = promisify(execFile)
const repository = fileURLToPath(new URL('../../../', import.meta.url))
const uuid = /^[0-9a-f-]{36}$/
type Job = Static<typeof JobDetailSchema>

// Opt-in, fresh projects only. Do not reuse the developer's normal/smoke volumes,
// ports, credentials or deployment env file, even when a test fails.
test('Docker crash recovery, recreation and backup restore preserve Jobs history and queued work', async () => {
  assert.equal(process.env.JOBS_DEPLOYMENT_TEST, 'true', 'Set JOBS_DEPLOYMENT_TEST=true and provide local server/web images.')
  const root = await mkdtemp(join(tmpdir(), 'enspatium-jobs-test-'))
  const project = 'ensp-jobs-' + randomUUID().replaceAll('-', '').slice(0, 12)
  const recovery = project + '-recovery'
  const envFile = join(root, 'deployment.env')
  const imagesFile = join(root, 'images.json')
  const snapshot = join(root, 'snapshot')
  const compose = (name: string, ...files: string[]) => ['compose', '--env-file', envFile, '-p', name, ...files.flatMap(file => ['-f', file])]
  const sourceCompose = compose(project, join(repository, 'compose.yaml'), imagesFile)
  const recoveryCompose = compose(recovery, join(snapshot, 'compose.yaml'), join(snapshot, 'images.json'))
  let sourceCreated = false
  let recoveryCreated = false
  let origin = ''
  let ca = Buffer.alloc(0)
  let cookie = ''
  const releases: (() => Promise<void>)[] = []
  const progress = (message: string) => console.info('[jobs] ' + message)
  async function docker(args: string[], timeout = 120_000) {
    try { return (await exec('docker', args, { cwd: repository, timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024 })).stdout.trim() }
    catch { throw new Error('Jobs test Docker operation failed: ' + args.slice(0, 2).join(' ')) }
  }
  const db = (command: string[], query: string) => docker([...command, 'exec', '-T', 'db', 'psql', '-U', 'enspatium', '-d', 'enspatium', '-v', 'ON_ERROR_STOP=1', '-Atc', query])
  async function backup(args: string[]) {
    try {
      const result = await exec(process.execPath, ['deploy/backup.mjs', ...args], { cwd: repository, timeout: 600_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 })
      return JSON.parse(result.stdout) as { status: string }
    } catch (error) { throw new Error(String((error as { stderr?: string }).stderr || 'Jobs backup operation failed')) }
  }
  async function connect(command: string[], name: string) {
    const port = (await docker([...command, 'port', 'web', '443'])).split(':').at(-1)!
    assert.match(port, /^\d+$/)
    origin = 'https://localhost:' + port
    const caFile = join(root, name + '-ca.pem')
    await docker([...command, 'cp', 'web:/data/caddy/pki/authorities/local/root.crt', caFile])
    ca = await readFile(caFile)
    // Web has no Compose healthcheck and its random host port can change even
    // after stop/start. Discover the port and wait for HTTPS on every restart.
    await expect.poll(async () => {
      try { await http('GET', '/api/health/db'); return true } catch { return false }
    }, { timeout: 30_000, interval: 500 }).toBe(true)
  }
  async function http(method: string, path: string, status = 200, body?: unknown) {
    const bytes = body === undefined ? undefined : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
    return new Promise<Buffer>((accept, reject) => {
      const req = request(new URL(path, origin), { method, ca, timeout: 15_000, headers: {
        origin, ...(cookie ? { cookie } : {}), ...(bytes ? { 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json', 'content-length': bytes.length } : {}),
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
      req.on('timeout', () => req.destroy(new Error(`Jobs test HTTP request timed out: ${method} ${path}`)))
      req.on('error', reject)
      req.end(bytes)
    })
  }
  const json = async <T>(method: string, path: string, status = 200, body?: unknown) => JSON.parse((await http(method, path, status, body)).toString()) as T
  const readJob = (id: string) => json<Job>('GET', '/api/admin/jobs/' + id)
  async function waitJob(id: string, status: Job['status']) {
    await expect.poll(async () => (await readJob(id)).status, { timeout: 20_000, interval: 200 }).toBe(status)
    return readJob(id)
  }
  // A tagged external transaction holds only this test's table/row. Waiting for
  // PgSleep proves the preceding lock was acquired; terminating the tagged
  // session releases it even when an assertion or the simulated crash fails.
  async function hold(query: string, suffix: string) {
    const tag = project + '-' + suffix
    const completed = db(sourceCompose, `SET application_name = '${tag}'; BEGIN; ${query}; SELECT pg_sleep(600); ROLLBACK`).then(() => {}, () => {})
    let released = false
    const release = async () => {
      if (released) return
      await db(sourceCompose, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = '${tag}' AND datname = current_database()`)
      await completed
      released = true
    }
    releases.push(release)
    await expect.poll(() => db(sourceCompose, `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = '${tag}' AND wait_event = 'PgSleep')`), { timeout: 10_000 }).toBe('t')
    return release
  }
  try {
    const images: Record<string, string> = {}
    for (const [service, variable] of [['server', 'JOBS_TEST_SERVER_IMAGE'], ['web', 'JOBS_TEST_WEB_IMAGE']] as const) {
      const name = process.env[variable]
      assert.ok(name && !name.startsWith('-'), 'Provide ' + variable + ' as a local image name or ID.')
      images[service] = await docker(['image', 'inspect', '--format', '{{.Id}}', name])
      assert.match(images[service]!, /^sha256:[0-9a-f]{64}$/)
    }
    images.db = await docker(['image', 'inspect', '--format', '{{.Id}}', 'postgres:17-bookworm'])
    assert.match(images.db, /^sha256:[0-9a-f]{64}$/)
    for (const name of [project, recovery]) {
      expect(await docker(['ps', '-a', '-q', '--filter', 'label=com.docker.compose.project=' + name])).toBe('')
      expect(await docker(['volume', 'ls', '-q', '--filter', 'name=^' + name + '_'])).toBe('')
      expect(await docker(['network', 'ls', '-q', '--filter', 'name=^' + name + '_'])).toBe('')
    }
    const config = { POSTGRES_PASSWORD: randomBytes(32).toString('hex'), SESSION_KEY: randomBytes(32).toString('hex'), SITE_ADDRESS: 'https://localhost', HTTP_BIND: '127.0.0.1', HTTP_PORT: '0', HTTPS_PORT: '0', REGISTRATION_ENABLED: 'true' }
    await writeFile(envFile, Object.entries(config).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n'), { mode: 0o600 })
    await writeFile(imagesFile, JSON.stringify({ services: Object.fromEntries(['server', 'migrate', 'web', 'db'].map(name => [name, { image: images[name === 'migrate' ? 'server' : name], pull_policy: 'never' }])) }))
    sourceCreated = true
    progress('Starting a fresh HTTPS deployment with isolated volumes.')
    await docker([...sourceCompose, 'up', '-d', '--no-build', '--wait'])
    await connect(sourceCompose, 'source')
    const user = { email: 'jobs@example.test', displayName: 'Jobs test', password: randomBytes(24).toString('hex') }
    const admin = await json<{ id: string }>('POST', '/api/users', 201, user)
    assert.match(admin.id, uuid)
    await http('POST', '/api/auth/login', 200, user)
    await db(sourceCompose, `UPDATE users SET is_admin = true WHERE id = '${admin.id}'`)
    const namespaces = await json<{ slug: string }[]>('GET', '/api/namespaces')
    const base = `/api/namespaces/${namespaces[0]!.slug}/spaces`
    const space = await json<{ id: string }>('POST', base, 201, { name: 'Jobs files', slug: 'jobs-files', type: 'object' })
    assert.match(space.id, uuid)
    await http('PUT', base + '/jobs-files/objects/report.txt', 201, 'Preserved content')
    const enqueue = () => json<Job>('POST', '/api/admin/jobs', 202, { kind: 'storage.check', payload: { spaceId: space.id, deep: true } })
    const first = await waitJob((await enqueue()).id, 'succeeded')
    expect(first.result).toMatchObject({ status: 'ok', complete: true, spaces: [expect.objectContaining({ filesChecked: 1, hashesChecked: 1 })] })
    expect((await http('GET', '/settings/admin/jobs/' + first.id)).toString()).toContain('<!doctype html>')

    progress('Killing the backend after a real claim while its scan is blocked.')
    const releaseScan = await hold('LOCK TABLE space_object_versions IN ACCESS EXCLUSIVE MODE', 'scan')
    let interrupted: Job
    try {
      // Block only scan metadata, not the Space/User foreign keys needed to
      // admit a job. Locking spaces would also block PostgreSQL FK checks.
      interrupted = await json<Job>('POST', '/api/admin/jobs', 202, { kind: 'storage.check', payload: {} })
      await waitJob(interrupted.id, 'running')
      const server = await docker([...sourceCompose, 'ps', '-q', 'server'])
      assert.match(server, /^[0-9a-f]{64}$/)
      await docker(['update', '--restart=no', server])
      await docker(['kill', '--signal=KILL', server])
      expect(await db(sourceCompose, `SELECT status FROM jobs WHERE id = '${interrupted.id}'`)).toBe('running')
    } finally { await releaseScan() }
    await docker([...sourceCompose, 'up', '-d', '--no-build', '--wait'])
    await connect(sourceCompose, 'restarted')
    const failed = await waitJob(interrupted.id, 'failed')
    expect(failed).toMatchObject({ errorCode: 'WORKER_INTERRUPTED', result: null, canRetry: true })
    expect(failed.startedAt).not.toBeNull()
    expect(await readJob(first.id)).toEqual(first)
    const retried = await json<Job>('POST', `/api/admin/jobs/${failed.id}/retry`, 202)
    const retry = await waitJob(retried.id, 'succeeded')
    expect(retry.retryOfJobId).toBe(failed.id)
    expect(await readJob(failed.id)).toEqual(failed)

    progress('Recreating all containers with existing volumes and a queued job.')
    await docker([...sourceCompose, 'stop', '--timeout', '30', 'web', 'server'])
    const queuedId = randomUUID()
    const cancelledId = randomUUID()
    await db(sourceCompose, `INSERT INTO jobs (id, kind, requested_by_user_id, space_id, payload) VALUES ('${queuedId}', 'storage.check', '${admin.id}', '${space.id}', '{"spaceId":"${space.id}","deep":true}')`)
    await db(sourceCompose, `INSERT INTO jobs (id, kind, requested_by_user_id, payload, status, finished_at) VALUES ('${cancelledId}', 'storage.check', '${admin.id}', '{"deep":false}', 'cancelled', CURRENT_TIMESTAMP)`)
    const queuedBefore = await db(sourceCompose, `SELECT row_to_json(jobs) FROM jobs WHERE id = '${queuedId}'`)
    const oldDb = await docker([...sourceCompose, 'ps', '-q', 'db'])
    await docker([...sourceCompose, 'down', '--timeout', '30']) // Deliberately keep volumes.
    await docker([...sourceCompose, 'up', '-d', '--no-build', '--wait', 'db'])
    expect(await docker([...sourceCompose, 'ps', '-q', 'db'])).not.toBe(oldDb)
    expect(await db(sourceCompose, `SELECT row_to_json(jobs) FROM jobs WHERE id = '${queuedId}'`)).toBe(queuedBefore)
    await docker([...sourceCompose, 'up', '-d', '--no-build', '--wait'])
    await connect(sourceCompose, 'recreated')
    await waitJob(queuedId, 'succeeded')
    expect(await readJob(first.id)).toEqual(first)
    expect(await readJob(failed.id)).toEqual(failed)
    expect(await readJob(retry.id)).toEqual(retry)
    expect(await readJob(cancelledId)).toMatchObject({ status: 'cancelled', startedAt: null, result: null })
    const history = await Promise.all([first.id, failed.id, retry.id, queuedId, cancelledId].map(readJob))

    // Keep one visible queued row locked through backup. The worker skips it;
    // pg_dump sees it without waiting for the row lock. No production setting or
    // alternate worker implementation is needed to make this deterministic.
    await docker([...sourceCompose, 'stop', '--timeout', '30', 'web', 'server'])
    const pendingId = randomUUID()
    await db(sourceCompose, `INSERT INTO jobs (id, kind, requested_by_user_id, space_id, payload) VALUES ('${pendingId}', 'storage.check', '${admin.id}', '${space.id}', '{"spaceId":"${space.id}","deep":true}')`)
    const releasePending = await hold(`SELECT id FROM jobs WHERE id = '${pendingId}' FOR UPDATE`, 'pending')
    let pending: Job
    try {
      await docker([...sourceCompose, 'up', '-d', '--no-build', '--wait'])
      await connect(sourceCompose, 'pending')
      pending = await readJob(pendingId)
      expect(pending).toMatchObject({ status: 'queued', startedAt: null, result: null })
      progress('Backing up terminal history and queued work with the operator backup tool.')
      expect((await backup(['create', '--env-file', envFile, '--project', project, '--output', snapshot])).status).toBe('created')
      await connect(sourceCompose, 'after-backup')
      expect(await readJob(pendingId)).toEqual(pending)
    } finally { await releasePending() }
    await waitJob(pendingId, 'succeeded')
    const afterBackup = await waitJob((await enqueue()).id, 'succeeded')
    expect((await backup(['verify', '--env-file', envFile, '--backup', snapshot])).status).toBe('verified')
    recoveryCreated = true
    expect((await backup(['restore', '--env-file', envFile, '--backup', snapshot, '--project', recovery])).status).toBe('restored')
    await docker([...recoveryCompose, 'up', '-d', '--no-build', '--wait', 'db'])
    expect(await db(recoveryCompose, `SELECT status FROM jobs WHERE id = '${pendingId}'`)).toBe('queued')
    expect(await db(recoveryCompose, `SELECT count(*) FROM jobs WHERE id = '${afterBackup.id}'`)).toBe('0')
    await docker([...recoveryCompose, 'up', '-d', '--no-build', '--wait'])
    await connect(recoveryCompose, 'restored')
    await http('GET', '/api/auth/me') // Same SESSION_KEY retains the admin session.
    for (const saved of history) expect(await readJob(saved.id)).toEqual(saved)
    const resumed = await waitJob(pendingId, 'succeeded')
    expect(resumed).toMatchObject({ createdAt: pending.createdAt, payload: pending.payload, requestedByUserId: pending.requestedByUserId, result: { status: 'ok', complete: true } })
    expect((await http('GET', base + '/jobs-files/objects/report.txt')).toString()).toBe('Preserved content')
    expect((await json<{ jobs: Job[] }>('GET', '/api/admin/jobs')).jobs).toHaveLength(6)
    await connect(sourceCompose, 'source-final')
    expect(await readJob(afterBackup.id)).toEqual(afterBackup)
    progress('Crash recovery, unchanged reports, retry links, queued restart and isolated restore verified.')
  } finally {
    const failures: unknown[] = []
    for (const release of releases.reverse()) { try { await release() } catch (error) { failures.push(error) } }
    assert.match(project, /^ensp-jobs-[0-9a-f]{12}$/)
    for (const [created, name, command] of [[recoveryCreated, recovery, recoveryCompose], [sourceCreated, project, sourceCompose]] as const) {
      if (!created) continue
      try {
        await docker([...command, 'down', '--timeout', '30', '--volumes', '--remove-orphans'])
        expect(await docker(['volume', 'ls', '-q', '--filter', 'name=^' + name + '_'])).toBe('')
      } catch (error) { failures.push(error) }
    }
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert.ok(root.startsWith(join(tmpdir(), 'enspatium-jobs-test-')))
    if (failures.length) throw new AggregateError(failures, 'Jobs test cleanup failed; inspect temporary artifacts at ' + root)
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})
