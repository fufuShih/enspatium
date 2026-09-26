import { setTimeout as delay } from 'node:timers/promises'
import { expect, test } from 'vitest'

import type { Job, JobStatus } from '../src/db/types/job.types.js'
import { claimNextJob, createJob, retryJob } from '../src/services/jobs/queue.js'
import { JobWorker } from '../src/services/jobs/runner.js'
import { acquireStorageWrite } from '../src/services/space/storage-access.js'
import { createFixture } from './fixture.js'

const terminalStatuses = new Set<JobStatus>(['succeeded', 'failed', 'cancelled'])

test('embedded worker runs storage checks and revalidates current admin access', async ({ onTestFinished }) => {
  const workers: JobWorker[] = []
  const { app } = await createFixture({
    after: cleanup => onTestFinished(async () => {
      try { for (const worker of workers) await worker.close() }
      finally { await cleanup() }
    }),
    diagnostic: message => console.info(message),
  })
  const requester = await app.db
    .insertInto('users')
    .values({
      email: 'worker@example.test',
      display_name: 'Worker admin',
      password_hash: 'not-used',
      is_admin: true,
    })
    .returning('id')
    .executeTakeFirstOrThrow()
  const namespace = await app.db
    .insertInto('namespaces')
    .values({ owner_user_id: requester.id, name: 'Worker admin', slug: 'worker-admin', kind: 'personal' })
    .returning('id')
    .executeTakeFirstOrThrow()
  const removedSpace = await app.db
    .insertInto('spaces')
    .values({ namespace_id: namespace.id, created_by_user_id: requester.id, name: 'Removed', slug: 'removed', type: 'object' })
    .returning('id')
    .executeTakeFirstOrThrow()
  const worker = new JobWorker(app, 10)
  workers.push(worker)

  const missingSpace = await createJob(app.db, {
    kind: 'storage.check', payload: { spaceId: removedSpace.id }, requestedByUserId: requester.id,
  })
  await app.db.deleteFrom('spaces').where('id', '=', removedSpace.id).execute()
  await worker.start()
  expect(await waitForTerminalJob(app, missingSpace.id)).toMatchObject({
    status: 'failed',
    result: null,
    error_code: 'SPACE_NOT_FOUND',
    space_id: null,
  })

  const successful = await createJob(app.db, {
    kind: 'storage.check', payload: {}, requestedByUserId: requester.id,
  })
  expect(await waitForTerminalJob(app, successful.id)).toMatchObject({
    status: 'succeeded',
    result: { status: 'ok', complete: true, mode: 'basic', scope: 'all' },
    error_code: null,
  })

  await app.db.updateTable('users').set({ is_admin: false }).where('id', '=', requester.id).execute()
  const unauthorized = await createJob(app.db, {
    kind: 'storage.check', payload: { deep: true }, requestedByUserId: requester.id,
  })
  expect(await waitForTerminalJob(app, unauthorized.id)).toMatchObject({
    status: 'failed',
    result: null,
    error_code: 'PERMISSION_REVOKED',
  })

  await app.db.updateTable('users').set({ is_admin: true }).where('id', '=', requester.id).execute()
  const releaseStorage = acquireStorageWrite(app.config.DATA_ROOT)
  try {
    const busy = await createJob(app.db, {
      kind: 'storage.check', payload: {}, requestedByUserId: requester.id,
    })
    expect(await waitForTerminalJob(app, busy.id)).toMatchObject({
      status: 'failed',
      result: null,
      error_code: 'STORAGE_BUSY',
    })
  } finally {
    releaseStorage()
  }

  await worker.close()
  const leftQueued = await createJob(app.db, {
    kind: 'storage.check', payload: {}, requestedByUserId: requester.id,
  })
  await delay(30)
  expect(await readJob(app, leftQueued.id)).toMatchObject({ status: 'queued', started_at: null })

  const restarted = new JobWorker(app, 10)
  workers.push(restarted)
  await restarted.start()
  expect(await waitForTerminalJob(app, leftQueued.id)).toMatchObject({ status: 'succeeded' })
  await restarted.close()

  // Simulate a process that claimed work but stopped before saving its result.
  const interrupted = await createJob(app.db, {
    kind: 'storage.check', payload: {}, requestedByUserId: requester.id,
  })
  expect((await claimNextJob(app.db))?.id).toBe(interrupted.id)
  const recovered = new JobWorker(app, 10)
  workers.push(recovered)
  await recovered.start()
  expect(await readJob(app, interrupted.id)).toMatchObject({ status: 'failed', error_code: 'WORKER_INTERRUPTED' })
  const retried = await retryJob(app.db, requester.id, interrupted.id)
  expect(await waitForTerminalJob(app, retried.id)).toMatchObject({ status: 'succeeded', retry_of_job_id: interrupted.id })
  expect(await readJob(app, interrupted.id)).toMatchObject({ status: 'failed', error_code: 'WORKER_INTERRUPTED' })
  await recovered.close()
})

async function waitForTerminalJob(app: Awaited<ReturnType<typeof createFixture>>['app'], id: string): Promise<Job> {
  for (let attempt = 0; attempt < 250; attempt++) {
    const job = await readJob(app, id)
    if (terminalStatuses.has(job.status)) return job
    await delay(20)
  }
  throw new Error(`Job ${id} did not reach a terminal state.`)
}

function readJob(app: Awaited<ReturnType<typeof createFixture>>['app'], id: string) {
  return app.db.selectFrom('jobs').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
}
