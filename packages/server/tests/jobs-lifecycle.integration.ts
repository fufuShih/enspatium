import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { expect, test } from 'vitest'
import { createDb } from '../src/db/index.js'
import { cancelJob, claimNextJob, createJob, failJob, recoverInterruptedJobs, retryJob, succeedJob } from '../src/services/jobs/queue.js'
import { createFixture } from './fixture.js'

test('only admins cancel queued jobs; cancel and claim have exactly one winner', async ({ onTestFinished }) => {
  const { app } = await createFixture({ after: onTestFinished, diagnostic: () => {} })
  const admin = await app.db.insertInto('users').values({ email: 'admin@example.test', display_name: 'Admin', password_hash: 'unused', is_admin: true }).returning('id').executeTakeFirstOrThrow()
  const reader = await app.db.insertInto('users').values({ email: 'reader@example.test', display_name: 'Reader', password_hash: 'unused' }).returning('id').executeTakeFirstOrThrow()
  const enqueue = () => createJob(app.db, { kind: 'storage.check', payload: {}, requestedByUserId: admin.id })
  const queued = await enqueue()
  await expect(cancelJob(app.db, reader.id, queued.id)).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 })
  await expect(cancelJob(app.db, admin.id, randomUUID())).rejects.toMatchObject({ code: 'JOB_NOT_FOUND', statusCode: 404 })
  const cancelled = await cancelJob(app.db, admin.id, queued.id)
  expect(cancelled).toMatchObject({ status: 'cancelled', started_at: null, result: null, error_code: null })
  expect(cancelled.finished_at).toBeInstanceOf(Date)
  expect(await claimNextJob(app.db)).toBeUndefined()
  await expect(cancelJob(app.db, admin.id, queued.id)).rejects.toMatchObject({ code: 'JOB_STATE_CONFLICT' })
  await expect(retryJob(app.db, admin.id, queued.id)).rejects.toMatchObject({ code: 'JOB_STATE_CONFLICT' })

  const running = await enqueue()
  await claimNextJob(app.db)
  await expect(cancelJob(app.db, admin.id, running.id)).rejects.toMatchObject({ code: 'JOB_STATE_CONFLICT', statusCode: 409 })
  await failJob(app.db, running.id, { code: 'TEST_FAILURE', message: 'Test complete.' })
  await expect(cancelJob(app.db, admin.id, running.id)).rejects.toMatchObject({ code: 'JOB_STATE_CONFLICT' })

  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate = await enqueue()
    await expect(retryJob(app.db, admin.id, candidate.id)).rejects.toMatchObject({ code: 'JOB_STATE_CONFLICT' })
    const [cancellation, claim] = await Promise.allSettled([
      cancelJob(app.db, admin.id, candidate.id), claimNextJob(app.db),
    ])
    expect(claim.status).toBe('fulfilled')
    if (claim.status !== 'fulfilled') throw claim.reason
    if (cancellation.status === 'fulfilled') {
      expect(claim.value).toBeUndefined()
      expect(cancellation.value.status).toBe('cancelled')
    } else {
      expect(cancellation.reason).toMatchObject({ code: 'JOB_STATE_CONFLICT', statusCode: 409 })
      expect(claim.value).toMatchObject({ id: candidate.id, status: 'running' })
      await expect(retryJob(app.db, admin.id, candidate.id)).rejects.toMatchObject({ code: 'JOB_STATE_CONFLICT' })
      await failJob(app.db, candidate.id, { code: 'TEST_FAILURE', message: 'Test complete.' })
    }
    await expect(cancelJob(app.db, admin.id, candidate.id)).rejects.toMatchObject({ code: 'JOB_STATE_CONFLICT' })
  }
})

test('retry creates an authorized new job without changing history and rejects duplicate pending work', async ({ onTestFinished }) => {
  const { app } = await createFixture({ after: onTestFinished, diagnostic: () => {} })
  const first = await app.db.insertInto('users').values({ email: 'first@example.test', display_name: 'First', password_hash: 'unused', is_admin: true }).returning('id').executeTakeFirstOrThrow()
  const actor = await app.db.insertInto('users').values({ email: 'actor@example.test', display_name: 'Actor', password_hash: 'unused', is_admin: true }).returning('id').executeTakeFirstOrThrow()
  const original = await createJob(app.db, { kind: 'storage.check', payload: { deep: true }, requestedByUserId: first.id })
  await claimNextJob(app.db)
  const failed = await failJob(app.db, original.id, { code: 'STORAGE_BUSY', message: 'Storage was busy.' })
  const readOriginal = () => app.db.selectFrom('jobs').selectAll().where('id', '=', original.id).executeTakeFirstOrThrow()

  await expect(retryJob(app.db, actor.id, randomUUID())).rejects.toMatchObject({ code: 'JOB_NOT_FOUND' })
  await app.db.updateTable('users').set({ is_admin: false }).where('id', '=', actor.id).execute()
  await expect(retryJob(app.db, actor.id, original.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  await app.db.updateTable('users').set({ is_admin: true, is_disabled: true }).where('id', '=', actor.id).execute()
  await expect(retryJob(app.db, actor.id, original.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  await app.db.updateTable('users').set({ is_disabled: false }).where('id', '=', actor.id).execute()

  // A concurrent suspension must finish before retry's authorization decision.
  let denied: Promise<unknown> | undefined
  await app.db.transaction().execute(async tx => {
    await tx.updateTable('users').set({ is_disabled: true }).where('id', '=', actor.id).execute()
    denied = expect(retryJob(app.db, actor.id, original.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
  await denied
  await app.db.updateTable('users').set({ is_disabled: false }).where('id', '=', actor.id).execute()

  const attempts = await Promise.allSettled(Array.from({ length: 6 }, () => retryJob(app.db, actor.id, original.id)))
  const accepted = attempts.filter(result => result.status === 'fulfilled')
  expect(accepted).toHaveLength(1)
  expect(attempts.filter(result => result.status === 'rejected').map(result => result.reason.code))
    .toEqual(Array(5).fill('JOB_ALREADY_PENDING'))
  const retry = accepted[0]!.value
  expect(retry.id).not.toBe(original.id)
  expect(retry).toMatchObject({ status: 'queued', payload: original.payload, retry_of_job_id: original.id, requested_by_user_id: actor.id, started_at: null, finished_at: null, error_code: null })
  expect(await readOriginal()).toEqual(failed)
  await claimNextJob(app.db)
  await succeedJob(app.db, retry.id, { status: 'ok' })
  await expect(retryJob(app.db, actor.id, retry.id)).rejects.toMatchObject({ code: 'JOB_STATE_CONFLICT' })
  await expect(cancelJob(app.db, actor.id, retry.id)).rejects.toMatchObject({ code: 'JOB_STATE_CONFLICT' })

  // A manual retry uses the current actor, including when the old requester is gone.
  await app.db.deleteFrom('users').where('id', '=', first.id).execute()
  const afterDeletion = await retryJob(app.db, actor.id, original.id)
  expect(afterDeletion.requested_by_user_id).toBe(actor.id)
  expect((await readOriginal()).requested_by_user_id).toBeNull()
  await cancelJob(app.db, actor.id, afterDeletion.id)
})

test('retry revalidates saved payload, handler and Space without widening the scope', async ({ onTestFinished }) => {
  const { app } = await createFixture({ after: onTestFinished, diagnostic: () => {} })
  const admin = await app.db.insertInto('users').values({ email: 'scope@example.test', display_name: 'Admin', password_hash: 'unused', is_admin: true }).returning('id').executeTakeFirstOrThrow()
  const namespace = await app.db.insertInto('namespaces').values({ owner_user_id: admin.id, name: 'Jobs', slug: 'job-scope', kind: 'personal' }).returning('id').executeTakeFirstOrThrow()
  const space = await app.db.insertInto('spaces').values({ namespace_id: namespace.id, created_by_user_id: admin.id, name: 'Files', slug: 'files', type: 'object' }).returning('id').executeTakeFirstOrThrow()
  const job = await createJob(app.db, { kind: 'storage.check', payload: { spaceId: space.id }, requestedByUserId: admin.id })
  await claimNextJob(app.db)
  await failJob(app.db, job.id, { code: 'STORAGE_BUSY', message: 'Storage busy.' })
  const retry = await retryJob(app.db, admin.id, job.id)
  expect(retry).toMatchObject({ space_id: space.id, payload: { spaceId: space.id }, retry_of_job_id: job.id })
  await cancelJob(app.db, admin.id, retry.id)
  await app.db.deleteFrom('spaces').where('id', '=', space.id).execute()
  await expect(retryJob(app.db, admin.id, job.id)).rejects.toMatchObject({ code: 'JOB_REFERENCE_NOT_FOUND' })

  await sql`UPDATE jobs SET payload = '{"command":"arbitrary"}'::jsonb WHERE id = ${job.id}`.execute(app.db)
  await expect(retryJob(app.db, admin.id, job.id)).rejects.toMatchObject({ code: 'INVALID_JOB_PAYLOAD' })
  await sql`UPDATE jobs SET payload = '{"deep":false}'::jsonb, kind = 'future.write' WHERE id = ${job.id}`.execute(app.db)
  await expect(retryJob(app.db, admin.id, job.id)).rejects.toMatchObject({ code: 'JOB_NOT_RETRYABLE' })
  expect(await app.db.selectFrom('jobs').select('id').where('status', 'in', ['queued', 'running']).execute()).toEqual([])
})

test('startup recovery persists interrupted failures, preserves other states and is idempotent', async ({ onTestFinished }) => {
  const { app } = await createFixture({ after: onTestFinished, diagnostic: () => {} })
  const admin = await app.db.insertInto('users').values({ email: 'restart@example.test', display_name: 'Admin', password_hash: 'unused', is_admin: true }).returning('id').executeTakeFirstOrThrow()
  const enqueue = () => createJob(app.db, { kind: 'storage.check', payload: {}, requestedByUserId: admin.id })
  const completed = await enqueue()
  await claimNextJob(app.db)
  await succeedJob(app.db, completed.id, { status: 'issues', complete: true })
  const cancelled = await enqueue()
  await cancelJob(app.db, admin.id, cancelled.id)
  const interrupted = await enqueue()
  await claimNextJob(app.db)
  // A future handler can be queued alongside the one permitted storage check.
  await sql`INSERT INTO jobs (kind, requested_by_user_id, payload) VALUES ('future.check', ${admin.id}, '{}'::jsonb)`.execute(app.db)
  const untouched = await app.db.selectFrom('jobs').selectAll().where('status', '!=', 'running').orderBy('id').execute()
  // Use a fresh connection to verify recovery is based on persisted state.
  const reopened = createDb(app.config.DATABASE_URL)
  try {
    expect(await recoverInterruptedJobs(reopened)).toBe(1n)
    const recovered = await reopened.selectFrom('jobs').selectAll().where('id', '=', interrupted.id).executeTakeFirstOrThrow()
    expect(recovered).toMatchObject({ status: 'failed', error_code: 'WORKER_INTERRUPTED', result: null })
    expect(recovered.finished_at).toBeInstanceOf(Date)
    expect(await recoverInterruptedJobs(reopened)).toBe(0n)
    expect(await reopened.selectFrom('jobs').selectAll().where('id', '!=', interrupted.id).orderBy('id').execute()).toEqual(untouched)
    await expect(succeedJob(app.db, interrupted.id, {})).rejects.toMatchObject({ code: 'JOB_STATE_CONFLICT' })
    const retried = await retryJob(app.db, admin.id, interrupted.id)
    expect(retried).toMatchObject({ status: 'queued', retry_of_job_id: interrupted.id })
    expect(await reopened.selectFrom('jobs').selectAll().where('id', '=', interrupted.id).executeTakeFirstOrThrow()).toEqual(recovered)
  } finally { await reopened.destroy() }
})
