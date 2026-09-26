import { randomUUID } from 'node:crypto'
import { expect, test } from 'vitest'

import {
  claimNextJob,
  createJob,
  failJob,
  succeedJob,
} from '../src/services/jobs/queue.js'
import { maximumJobResultBytes } from '../src/services/jobs/registry.js'
import { createFixture } from './fixture.js'

test('job queue validates input, claims atomically and preserves terminal results', async ({ onTestFinished }) => {
  const { app } = await createFixture({
    after: cleanup => onTestFinished(cleanup),
    diagnostic: message => console.info(message),
  })
  const requester = await app.db
    .insertInto('users')
    .values({
      email: 'jobs@example.test',
      display_name: 'Job requester',
      password_hash: 'not-used',
    })
    .returning('id')
    .executeTakeFirstOrThrow()

  await expect(createJob(app.db, {
    kind: 'unknown', payload: {}, requestedByUserId: requester.id,
  })).rejects.toMatchObject({ code: 'INVALID_JOB_KIND', statusCode: 400 })
  await expect(createJob(app.db, {
    kind: 'storage.check', payload: { extra: true }, requestedByUserId: requester.id,
  })).rejects.toMatchObject({ code: 'INVALID_JOB_PAYLOAD', statusCode: 400 })
  await expect(createJob(app.db, {
    kind: 'storage.check', payload: { spaceId: randomUUID() }, requestedByUserId: requester.id,
  })).rejects.toMatchObject({ code: 'JOB_REFERENCE_NOT_FOUND', statusCode: 400 })

  const submissions = await Promise.allSettled(Array.from({ length: 6 }, () => createJob(app.db, {
    kind: 'storage.check', payload: {}, requestedByUserId: requester.id,
  })))
  const created = submissions.filter(result => result.status === 'fulfilled')
  const rejected = submissions.filter(result => result.status === 'rejected')
  expect(created).toHaveLength(1)
  expect(rejected).toHaveLength(5)
  expect(rejected.every(result => result.reason?.code === 'JOB_ALREADY_PENDING')).toBe(true)

  const queued = created[0]!.value
  expect(queued).toMatchObject({
    kind: 'storage.check',
    status: 'queued',
    payload: { deep: false },
    space_id: null,
    requested_by_user_id: requester.id,
    started_at: null,
    finished_at: null,
  })

  const claims = await Promise.all(Array.from({ length: 6 }, () => claimNextJob(app.db)))
  const claimed = claims.filter(job => job !== undefined)
  expect(claimed).toHaveLength(1)
  expect(claimed[0]).toMatchObject({ id: queued.id, status: 'running' })
  expect(claimed[0]!.started_at).toBeInstanceOf(Date)
  await expect(succeedJob(app.db, queued.id, { report: 'x'.repeat(maximumJobResultBytes) }))
    .rejects.toMatchObject({ code: 'INVALID_JOB_RESULT', statusCode: 400 })

  const succeeded = await succeedJob(app.db, queued.id, { status: 'issues', issueCount: 2 })
  expect(succeeded).toMatchObject({
    status: 'succeeded',
    result: { status: 'issues', issueCount: 2 },
    error_code: null,
    error_message: null,
  })
  expect(succeeded.finished_at).toBeInstanceOf(Date)
  await expect(succeedJob(app.db, queued.id, {}))
    .rejects.toMatchObject({ code: 'JOB_STATE_CONFLICT', statusCode: 409 })

  const failedJob = await createJob(app.db, {
    kind: 'storage.check',
    payload: { deep: true },
    requestedByUserId: requester.id,
  })
  expect(failedJob).toMatchObject({ payload: { deep: true }, retry_of_job_id: null })
  expect((await claimNextJob(app.db))?.id).toBe(failedJob.id)
  await expect(failJob(app.db, failedJob.id, { code: 'invalid-code', message: 'bad' }))
    .rejects.toMatchObject({ code: 'INVALID_JOB_ERROR', statusCode: 400 })
  const failed = await failJob(app.db, failedJob.id, { code: 'STORAGE_CHECK_FAILED', message: 'Scan failed safely.' })
  expect(failed).toMatchObject({
    status: 'failed',
    result: null,
    error_code: 'STORAGE_CHECK_FAILED',
    error_message: 'Scan failed safely.',
  })

  await app.db.deleteFrom('users').where('id', '=', requester.id).executeTakeFirstOrThrow()
  const history = await app.db.selectFrom('jobs').selectAll().orderBy('created_at').orderBy('id').execute()
  expect(history).toHaveLength(2)
  expect(history.every(job => job.requested_by_user_id === null)).toBe(true)
})
