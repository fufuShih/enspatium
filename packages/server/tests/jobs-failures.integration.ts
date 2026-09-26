import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { sql } from 'kysely'
import { afterEach, expect, test, vi } from 'vitest'
import * as files from '../src/services/storage-check/filesystem.js'
import * as handlers from '../src/services/jobs/handlers.js'
import { createJob, retryJob } from '../src/services/jobs/queue.js'
import { maximumJobResultBytes } from '../src/services/jobs/registry.js'
import { JobWorker } from '../src/services/jobs/runner.js'
import { acquireStorageWrite } from '../src/services/space/storage-access.js'
import { createFixture } from './fixture.js'

afterEach(() => vi.restoreAllMocks())

async function setup(after: (cleanup: () => Promise<void>) => void) {
  const workers: JobWorker[] = []
  const { app } = await createFixture({
    after: cleanup => after(async () => {
      try { for (const worker of workers) await worker.close() }
      finally { await cleanup() }
    }), diagnostic: () => {},
  })
  const admin = await app.db.insertInto('users').values({ email: 'failure@example.test', display_name: 'Admin', password_hash: 'unused', is_admin: true }).returning('id').executeTakeFirstOrThrow()
  return {
    app, admin,
    enqueue: () => createJob(app.db, { kind: 'storage.check', payload: {}, requestedByUserId: admin.id }),
    read: (id: string) => app.db.selectFrom('jobs').selectAll().where('id', '=', id).executeTakeFirstOrThrow(),
    worker: () => { const worker = new JobWorker(app, 10); workers.push(worker); return worker },
  }
}

test('the scan deadline drains underlying work before releasing storage and saving an incomplete report', async ({ onTestFinished }) => {
  const { app, admin, enqueue, read, worker } = await setup(onTestFinished)
  const namespace = await app.db.insertInto('namespaces').values({ owner_user_id: admin.id, name: 'Scan', slug: 'scan', kind: 'personal' }).returning('id').executeTakeFirstOrThrow()
  const space = await app.db.insertInto('spaces').values({ namespace_id: namespace.id, created_by_user_id: admin.id, name: 'Files', slug: 'files', type: 'object' }).returning('id').executeTakeFirstOrThrow()
  await mkdir(join(app.config.DATA_ROOT, space.id))
  const controller = new AbortController()
  const entered = Promise.withResolvers<AbortSignal>()
  const drained = Promise.withResolvers<void>()
  const inspectTree = files.inspectTree
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
  const scan = vi.spyOn(files, 'inspectTree').mockImplementation(async (root, issue, signal) => {
    entered.resolve(signal!)
    await drained.promise
    return inspectTree(root, issue, signal)
  })
  const job = await enqueue()
  const running = worker()
  try {
    await running.start()
    expect(await entered.promise).toBe(controller.signal)
    expect(timeout).toHaveBeenCalledWith(120_000)
    controller.abort(new DOMException('Test scan deadline', 'TimeoutError'))
    let closed = false
    const closing = running.close().then(() => { closed = true })
    await delay(40)
    expect(closed).toBe(false)
    expect(await read(job.id)).toMatchObject({ status: 'running', result: null, finished_at: null })
    expect(() => acquireStorageWrite(app.config.DATA_ROOT)).toThrow('Storage is busy')
    drained.resolve()
    await closing
    expect(await read(job.id)).toMatchObject({ status: 'succeeded', result: { status: 'incomplete', complete: false, issues: expect.arrayContaining([expect.objectContaining({ code: 'CHECK_CANCELLED' })]) } })
    acquireStorageWrite(app.config.DATA_ROOT)()
  } finally { drained.resolve(); await running.close(); scan.mockRestore(); timeout.mockRestore() }
  const next = await enqueue()
  await worker().start()
  await expect.poll(async () => (await read(next.id)).status).toBe('succeeded')
})

test('oversized results and real PostgreSQL result-write failures never publish a successful job', async ({ onTestFinished }) => {
  const { app, enqueue, read, worker } = await setup(onTestFinished)
  const handler = vi.spyOn(handlers, 'runJobHandler').mockResolvedValueOnce({ report: 'x'.repeat(maximumJobResultBytes) })
  const oversized = await enqueue()
  await worker().start()
  await expect.poll(async () => (await read(oversized.id)).status).toBe('failed')
  expect(await read(oversized.id)).toMatchObject({ error_code: 'INVALID_JOB_RESULT', result: null })
  await sql`CREATE FUNCTION reject_job_success() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.status = 'succeeded' THEN RAISE EXCEPTION 'private database diagnostic'; END IF; RETURN NEW; END $$`.execute(app.db)
  await sql`CREATE TRIGGER reject_job_success BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION reject_job_success()`.execute(app.db)
  const unsaved = await enqueue()
  await expect.poll(async () => (await read(unsaved.id)).status).toBe('failed')
  expect(await read(unsaved.id)).toMatchObject({ error_code: 'RESULT_SAVE_FAILED', error_message: 'The job result could not be saved.', result: null })
  await delay(50)
  expect(handler).toHaveBeenCalledTimes(2) // Never replay either failed job.
  await sql`DROP TRIGGER reject_job_success ON jobs`.execute(app.db)
  const next = await enqueue()
  await expect.poll(async () => (await read(next.id)).status).toBe('succeeded')
})

test('losing both terminal writes leaves a recoverable running row, not a false success or automatic replay', async ({ onTestFinished }) => {
  const { app, admin, enqueue, read, worker } = await setup(onTestFinished)
  const handler = vi.spyOn(handlers, 'runJobHandler')
  const logged = vi.spyOn(app.log, 'error')
  await sql`CREATE FUNCTION reject_job_outcome() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.status IN ('succeeded', 'failed') THEN RAISE EXCEPTION 'private database diagnostic'; END IF; RETURN NEW; END $$`.execute(app.db)
  await sql`CREATE TRIGGER reject_job_outcome BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION reject_job_outcome()`.execute(app.db)
  const job = await enqueue()
  const first = worker()
  await first.start()
  await expect.poll(() => logged.mock.calls.some(([entry]) => typeof entry === 'object' && entry !== null && 'event' in entry && entry.event === 'job.failure_save_failed')).toBe(true)
  await first.close()
  expect(await read(job.id)).toMatchObject({ status: 'running', result: null, error_code: null, finished_at: null })
  expect(handler).toHaveBeenCalledTimes(1)
  await expect(enqueue()).rejects.toMatchObject({ code: 'JOB_ALREADY_PENDING' })
  acquireStorageWrite(app.config.DATA_ROOT)()
  await sql`DROP TRIGGER reject_job_outcome ON jobs`.execute(app.db)
  const restarted = worker()
  await restarted.start()
  expect(await read(job.id)).toMatchObject({ status: 'failed', error_code: 'WORKER_INTERRUPTED', result: null })
  await delay(50)
  expect(handler).toHaveBeenCalledTimes(1)
  const retry = await retryJob(app.db, admin.id, job.id)
  await expect.poll(async () => (await read(retry.id)).status).toBe('succeeded')
  expect(await read(retry.id)).toMatchObject({ retry_of_job_id: job.id })
  expect(await read(job.id)).toMatchObject({ status: 'failed', error_code: 'WORKER_INTERRUPTED' })
})

test('suspension or deletion after enqueue cannot run work under stale administrator authority', async ({ onTestFinished }) => {
  const { app, admin, enqueue, read, worker } = await setup(onTestFinished)
  for (const change of ['suspend', 'delete'] as const) {
    const job = await enqueue()
    if (change === 'suspend') await app.db.updateTable('users').set({ is_disabled: true }).where('id', '=', admin.id).execute()
    else await app.db.deleteFrom('users').where('id', '=', admin.id).execute()
    const current = worker()
    await current.start()
    await expect.poll(async () => (await read(job.id)).status).toBe('failed')
    await current.close()
    expect(await read(job.id)).toMatchObject({ error_code: change === 'suspend' ? 'PERMISSION_REVOKED' : 'REQUESTER_NOT_FOUND', result: null, requested_by_user_id: change === 'suspend' ? admin.id : null })
    if (change === 'suspend') await app.db.updateTable('users').set({ is_disabled: false }).where('id', '=', admin.id).execute()
  }
})
