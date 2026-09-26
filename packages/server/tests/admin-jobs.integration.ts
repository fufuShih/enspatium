import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import type { Static } from '@sinclair/typebox'
import { expect, test } from 'vitest'
import { JobDetailSchema, JobListSchema } from '../src/routes/types/jobs.types.js'
import { claimNextJob, failJob } from '../src/services/jobs/queue.js'
import { JobWorker } from '../src/services/jobs/runner.js'
import { createFixture } from './fixture.js'

type Detail = Static<typeof JobDetailSchema>
type List = Static<typeof JobListSchema>

test('Jobs API enforces session, current admin, Origin, strict payloads and lifecycle conflicts', async ({ onTestFinished }) => {
  const { app, session } = await createFixture({ after: onTestFinished, diagnostic: () => {} })
  const client = session()
  const credentials = { email: 'jobs-admin@example.test', password: 'Jobs-test-password-1234' }
  await client.request('POST', '/users', 201, { ...credentials, displayName: 'Admin' })
  const missing = randomUUID()
  const routes = [['GET', '/admin/jobs'], ['POST', '/admin/jobs'], ['GET', '/admin/jobs/' + missing], ['POST', `/admin/jobs/${missing}/cancel`], ['POST', `/admin/jobs/${missing}/retry`]] as const
  for (const [method, path] of routes) await client.request(method, path, 401)
  await client.request('POST', '/auth/login', 200, credentials)
  for (const [method, path] of routes) await client.request(method, path, 403)
  const admin = await app.db.updateTable('users').set({ is_admin: true }).where('email', '=', credentials.email).returning('id').executeTakeFirstOrThrow()
  expect(await client.request<List>('GET', '/admin/jobs')).toEqual({ jobs: [], nextCursor: null })
  for (const body of [{}, { kind: 'arbitrary', payload: {} }, { kind: 'storage.check', payload: null }, { kind: 'storage.check', payload: [] }, { kind: 'storage.check', payload: { deep: 'true' } }, { kind: 'storage.check', payload: { command: 'bad' } }, { kind: 'storage.check', payload: { spaceId: 'bad' } }, { kind: 'storage.check', payload: { spaceId: missing } }, { kind: 'storage.check', payload: {}, extra: true }]) {
    await client.request('POST', '/admin/jobs', 400, body)
  }
  await client.request('GET', '/admin/jobs?status=bad', 400)
  await client.request('GET', '/admin/jobs?limit=101', 400)
  await client.request('GET', '/admin/jobs?cursor=' + missing, 400)
  await client.request('GET', '/admin/jobs/' + missing, 404)
  await client.request('GET', '/admin/jobs/invalid', 400)
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: credentials })
  const cookies = login.headers['set-cookie']
  const cookie = (Array.isArray(cookies) ? cookies : [String(cookies)]).map(value => value.split(';')[0]).join('; ')
  for (const path of ['/admin/jobs', `/admin/jobs/${missing}/cancel`, `/admin/jobs/${missing}/retry`]) {
    const response = await app.inject({ method: 'POST', url: path, headers: { cookie, origin: 'https://other.example', host: 'site.example' }, ...(path === '/admin/jobs' ? { payload: { kind: 'storage.check', payload: {} } } : {}) })
    expect(response.statusCode).toBe(403)
    expect(response.headers['cache-control']).toBe('private, no-store')
  }
  const accepted = await app.inject({ method: 'POST', url: '/admin/jobs', headers: { cookie, origin: 'http://site.example', host: 'site.example' }, payload: { kind: 'storage.check', payload: {} } })
  expect(accepted.statusCode).toBe(202)
  const first = accepted.json<Detail>()
  expect(first).toMatchObject({ status: 'queued', payload: { deep: false }, canCancel: true, canRetry: false, result: null, requestedByUserId: admin.id })
  await client.request('POST', '/admin/jobs', 409, { kind: 'storage.check', payload: {} })
  await client.request('POST', `/admin/jobs/${first.id}/retry`, 409)
  expect(await client.request<Detail>('POST', `/admin/jobs/${first.id}/cancel`)).toMatchObject({ status: 'cancelled', canCancel: false, finishedAt: expect.any(String) })
  await client.request('POST', `/admin/jobs/${first.id}/cancel`, 409)
  await client.request('POST', `/admin/jobs/${missing}/cancel`, 404)
  const original = await client.request<Detail>('POST', '/admin/jobs', 202, { kind: 'storage.check', payload: { deep: true } })
  await claimNextJob(app.db)
  await client.request('POST', `/admin/jobs/${original.id}/cancel`, 409)
  await failJob(app.db, original.id, { code: 'STORAGE_BUSY', message: 'Storage was busy.' })
  const failed = await client.request<Detail>('GET', '/admin/jobs/' + original.id)
  expect(failed).toMatchObject({ status: 'failed', canRetry: true, errorCode: 'STORAGE_BUSY' })
  const retried = await client.request<Detail>('POST', `/admin/jobs/${original.id}/retry`, 202)
  expect(retried).toMatchObject({ status: 'queued', retryOfJobId: original.id, payload: { deep: true } })
  expect(retried.id).not.toBe(original.id)
  expect(await client.request('GET', '/admin/jobs/' + original.id)).toEqual(failed)
  await client.request('POST', `/admin/jobs/${original.id}/retry`, 409)
  await client.request('POST', `/admin/jobs/${retried.id}/cancel`)
  await app.db.updateTable('users').set({ is_admin: false }).where('id', '=', admin.id).execute()
  for (const [method, path] of routes) await client.request(method, path, 403)
  await app.db.updateTable('users').set({ is_admin: true, is_disabled: true }).where('id', '=', admin.id).execute()
  for (const [method, path] of routes) await client.request(method, path, 401)
})

test('Jobs API paginates and filters without losing sub-millisecond timestamps or transferring reports', async ({ onTestFinished }) => {
  const { app, session } = await createFixture({ after: onTestFinished, diagnostic: () => {} })
  const client = session()
  const credentials = { email: 'pagination@example.test', password: 'Jobs-test-password-1234' }
  await client.request('POST', '/users', 201, { ...credentials, displayName: 'Admin' })
  await client.request('POST', '/auth/login', 200, credentials)
  await app.db.updateTable('users').set({ is_admin: true }).where('email', '=', credentials.email).execute()
  // Identical timestamps exercise the ID tie-breaker; the other group differs
  // within the same millisecond to catch precision loss in cursor handling.
  await sql`INSERT INTO jobs (kind, status, payload, created_at, finished_at, started_at, error_code, error_message)
    SELECT 'storage.check', CASE WHEN n % 2 = 0 THEN 'cancelled' ELSE 'failed' END, '{"deep":false}'::jsonb,
      '2025-01-01 00:00:00.123456+00'::timestamptz + (n % 3) * interval '1 microsecond',
      '2025-01-01 00:01:00+00'::timestamptz,
      CASE WHEN n % 2 = 1 THEN '2025-01-01 00:00:01+00'::timestamptz ELSE NULL END,
      CASE WHEN n % 2 = 1 THEN 'TEST_FAILURE' ELSE NULL END,
      CASE WHEN n % 2 = 1 THEN 'Test failure.' ELSE NULL END
      FROM generate_series(1, 65) AS n`.execute(app.db)
  const expected = await app.db.selectFrom('jobs').select('id').orderBy('created_at', 'desc').orderBy('id', 'desc').execute()
  const ids: string[] = []
  let cursor: string | null = null
  do {
    const page: List = await client.request('GET', '/admin/jobs' + (cursor ? '?cursor=' + cursor : ''))
    expect(page.jobs.length).toBeLessThanOrEqual(30)
    expect(page.jobs.every(job => !('result' in job))).toBe(true)
    ids.push(...page.jobs.map(job => job.id))
    cursor = page.nextCursor
  } while (cursor)
  expect(ids).toEqual(expected.map(job => job.id))
  const filtered = await client.request<List>('GET', '/admin/jobs?status=failed&limit=100')
  expect(filtered.jobs).toHaveLength(33)
  expect(filtered.jobs.every(job => job.status === 'failed')).toBe(true)
  expect(filtered.nextCursor).toBeNull()
})

test('Jobs API returns persisted worker reports and retains the synchronous check endpoint', async ({ onTestFinished }) => {
  const { app, session } = await createFixture({ after: onTestFinished, diagnostic: () => {} })
  const client = session()
  const credentials = { email: 'report@example.test', password: 'Jobs-test-password-1234' }
  await client.request('POST', '/users', 201, { ...credentials, displayName: 'Admin' })
  await client.request('POST', '/auth/login', 200, credentials)
  await app.db.updateTable('users').set({ is_admin: true }).where('email', '=', credentials.email).execute()
  const namespace = await app.db.selectFrom('namespaces').select('slug').executeTakeFirstOrThrow()
  const space = await client.request<{ id: string }>('POST', `/namespaces/${namespace.slug}/spaces`, 201, { name: 'Files', slug: 'files', type: 'object' })
  const job = await client.request<Detail>('POST', '/admin/jobs', 202, { kind: 'storage.check', payload: { spaceId: space.id.toUpperCase() } })
  expect(job).toMatchObject({ spaceId: space.id, payload: { spaceId: space.id, deep: false } })
  const worker = new JobWorker(app, 10)
  try {
    await worker.start()
    await expect.poll(async () => (await client.request<Detail>('GET', '/admin/jobs/' + job.id)).status).toBe('succeeded')
  } finally { await worker.close() }
  const saved = await client.request<Detail>('GET', '/admin/jobs/' + job.id)
  expect(saved).toMatchObject({ canCancel: false, canRetry: false, result: { status: 'ok', complete: true, mode: 'basic' } })
  expect(saved.result?.finishedAt).toEqual(expect.any(String))
  await client.request('POST', `/admin/jobs/${job.id}/retry`, 409)
  expect(await client.request('POST', '/admin/storage/check', 200, {})).toMatchObject({ status: 'ok', complete: true })
})
