import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { sql } from 'kysely'
import { Client } from 'pg'
import { buildApp } from '../src/app.js'
import { createDb } from '../src/db/index.js'
import { migrateDatabase } from '../src/db/migrations.js'

const execFileAsync = promisify(execFile)

export class ApiSession {
  private cookie = ''
  constructor(private readonly origin: string) {}

  async request<T = unknown>(method: string, path: string, expectedStatus = 200, body?: unknown): Promise<T> {
    const response = await fetch(this.origin + path, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(this.cookie ? { cookie: this.cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    })
    const cookies = response.headers.getSetCookie()
    if (cookies.length) this.cookie = cookies.map(cookie => cookie.split(';')[0]).join('; ')
    const text = await response.text()
    // Do not include response bodies: a token or session may be in them.
    assert.equal(response.status, expectedStatus, `${method} ${path}: unexpected HTTP status`)
    return (text ? JSON.parse(text) : undefined) as T
  }
}

export interface FixtureLifecycle {
  after(cleanup: () => Promise<void>): void
  diagnostic(message: string): void
  migrationTarget?: string
}

export async function createFixture(t: FixtureLifecycle) {
  try { process.loadEnvFile(new URL('../../../.env', import.meta.url)) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const databaseUrl = process.env.INTEGRATION_DATABASE_URL || process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('Set DATABASE_URL in the root .env, or set INTEGRATION_DATABASE_URL, and start PostgreSQL before running integration tests.')
  const schema = 'ensp_it_' + randomUUID().replaceAll('-', '')
  const admin = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000, query_timeout: 10_000 })
  let connected = false
  let schemaCreated = false
  let root: string | undefined
  let app: Awaited<ReturnType<typeof buildApp>> | undefined
  t.after(async () => {
    const failures: unknown[] = []
    try { await app?.close() } catch (error) { failures.push(error) }
    try {
      if (schemaCreated) {
        assert.match(schema, /^ensp_it_[0-9a-f]{32}$/)
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`)
        assert.equal((await admin.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [schema])).rowCount, 0)
      }
    } catch (error) { failures.push(error) }
    try { await admin.end() } catch (error) { if (connected) failures.push(error) }
    try {
      if (root) {
        assert.equal(dirname(resolve(root)), resolve(tmpdir()))
        assert.ok(root.startsWith(join(tmpdir(), 'enspatium-integration-')))
        await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
        await assert.rejects(stat(root), { code: 'ENOENT' })
      }
    } catch (error) { failures.push(error) }
    if (failures.length) throw new AggregateError(failures, `Cleanup failed. Test schema: ${schema}; temporary directory: ${root ?? '(not created)'}`)
    t.diagnostic('Cleaned temporary schema and storage.')
  })

  root = await mkdtemp(join(tmpdir(), 'enspatium-integration-'))
  const emptyGitConfig = join(root, 'gitconfig')
  await writeFile(emptyGitConfig, '')
  // Ignore developer Git credentials, hooks, signing and repository environment.
  for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key]
  Object.assign(process.env, { GIT_CONFIG_GLOBAL: emptyGitConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' })
  const baseGitEnvironment = { ...process.env }
  try { await execFileAsync('git', ['--version'], { timeout: 5_000, windowsHide: true }) } catch {
    throw new Error('Git CLI must be installed and available on PATH.')
  }
  try { await admin.connect(); connected = true } catch {
    throw new Error('Cannot connect to PostgreSQL. Start it and check DATABASE_URL or INTEGRATION_DATABASE_URL.')
  }
  try { await admin.query(`CREATE SCHEMA "${schema}"`); schemaCreated = true } catch {
    throw new Error('The integration database user must have permission to CREATE SCHEMA.')
  }
  const scopedUrl = new URL(databaseUrl)
  scopedUrl.searchParams.set('options', '-c search_path=' + schema)
  const scopedDb = createDb(scopedUrl.href)
  try {
    const result = await sql<{ schema: string }>`SELECT current_schema() AS schema`.execute(scopedDb)
    assert.equal(result.rows[0]?.schema, schema)
    const migrations = await migrateDatabase(scopedDb, schema, t.migrationTarget)
    if (migrations.error) throw migrations.error
    assert.ok(migrations.results?.length, 'Fresh schema must apply migrations')
    const repeated = await migrateDatabase(scopedDb, schema, t.migrationTarget)
    if (repeated.error) throw repeated.error
    assert.deepEqual(repeated.results, [], 'Re-running migrations must not apply them again')
    assert.deepEqual(await scopedDb.selectFrom('users').selectAll().execute(), [])
  } finally { await scopedDb.destroy() }

  Object.assign(process.env, {
    DATABASE_URL: scopedUrl.href,
    DATA_ROOT: join(root, 'data'),
    NODE_ENV: 'test',
    SESSION_KEY: randomBytes(32).toString('hex'),
    SESSION_SECURE: 'false',
  })
  app = await buildApp()
  app.log.level = 'silent'
  const origin = await app.listen({ host: '127.0.0.1', port: 0 })
  assert.equal((await sql<{ schema: string }>`SELECT current_schema() AS schema`.execute(app.db)).rows[0]?.schema, schema)

  async function git(args: string[], token?: string) {
    return execFileAsync('git', ['-c', 'credential.helper=', '-c', 'user.name=Integration User', '-c', 'user.email=integration@example.com', '-c', 'commit.gpgsign=false', ...args], {
      windowsHide: true,
      timeout: 20_000,
      env: {
        ...baseGitEnvironment,
        GIT_CONFIG_COUNT: token ? '1' : '0',
        ...(token ? { GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: 'Authorization: Basic ' + Buffer.from('git:' + token).toString('base64') } : {}),
      },
    })
  }
  return { origin, root, app, git, schema, session: () => new ApiSession(origin) }
}
