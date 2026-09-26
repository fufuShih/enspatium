import { sql, type Kysely, type Transaction } from 'kysely'

import type { Database } from '../../db/index.js'
import type {
  Job,
  JobQueueErrorCode,
} from '../../db/types/job.types.js'
import { requireSiteAdmin } from '../admin-users.js'
import {
  isJobKind,
  JobValidationError,
  validateJobPayload,
  validateJobResult,
} from './registry.js'

export interface CreateJobInput {
  kind: string
  payload: unknown
  requestedByUserId: string
}

export interface FailJobInput {
  code: string
  message: string
}

export class JobQueueError extends Error {
  constructor(
    readonly code: JobQueueErrorCode,
    readonly statusCode: number,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause })
    this.name = 'JobQueueError'
  }
}

export function createJob(db: Kysely<Database>, input: CreateJobInput): Promise<Job> {
  return insertJob(db, input, null)
}

export function createAdminJob(db: Kysely<Database>, input: CreateJobInput): Promise<Job> {
  return db.transaction().execute(async tx => {
    await requireLockedAdmin(tx, input.requestedByUserId)
    return insertJob(tx, input, null)
  })
}

async function insertJob(db: Kysely<Database>, input: CreateJobInput, retryOfJobId: string | null): Promise<Job> {
  if (!isJobKind(input.kind)) {
    throw new JobQueueError('INVALID_JOB_KIND', 400, 'unknown job kind')
  }

  let payload
  try {
    payload = validateJobPayload(input.kind, input.payload)
  } catch (error) {
    if (error instanceof JobValidationError) {
      throw new JobQueueError('INVALID_JOB_PAYLOAD', 400, error.message, error)
    }
    throw error
  }

  try {
    return await db
      .insertInto('jobs')
      .values({
        kind: input.kind,
        space_id: input.kind === 'storage.check' ? payload.spaceId ?? null : null,
        requested_by_user_id: input.requestedByUserId,
        status: 'queued',
        payload,
        result: null,
        error_code: null,
        error_message: null,
        retry_of_job_id: retryOfJobId,
        started_at: null,
        finished_at: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
  } catch (error) {
    if (isPostgresError(error, '23505', 'jobs_one_unfinished_storage_check')) {
      throw new JobQueueError('JOB_ALREADY_PENDING', 409, 'a storage check is already queued or running', error)
    }
    if (isPostgresError(error, '23503')) {
      throw new JobQueueError('JOB_REFERENCE_NOT_FOUND', 400, 'a referenced user, Space or Job does not exist', error)
    }
    throw new JobQueueError('INTERNAL', 500, 'failed to create job', error)
  }
}

export function claimNextJob(db: Kysely<Database>): Promise<Job | undefined> {
  return db.transaction().execute(async transaction => {
    const candidate = await transaction
      .selectFrom('jobs')
      .select('id')
      .where('status', '=', 'queued')
      .orderBy('created_at')
      .orderBy('id')
      .limit(1)
      .forUpdate()
      .skipLocked()
      .executeTakeFirst()

    if (!candidate) return undefined

    return transaction
      .updateTable('jobs')
      .set({ status: 'running', started_at: sql<Date>`GREATEST(created_at, clock_timestamp())` })
      .where('id', '=', candidate.id)
      .where('status', '=', 'queued')
      .returningAll()
      .executeTakeFirstOrThrow()
  })
}

export function cancelJob(db: Kysely<Database>, actor: string, id: string): Promise<Job> {
  return db.transaction().execute(async tx => {
    await requireLockedAdmin(tx, actor)
    // The conditional update races safely with claim's row lock. Running work
    // is never cancelled, even if it was queued when the request arrived.
    const cancelled = await tx.updateTable('jobs')
      .set({ status: 'cancelled', finished_at: sql<Date>`GREATEST(created_at, clock_timestamp())` })
      .where('id', '=', id).where('status', '=', 'queued')
      .returningAll().executeTakeFirst()
    if (cancelled) return cancelled
    const existing = await tx.selectFrom('jobs').select('id').where('id', '=', id).executeTakeFirst()
    if (!existing) throw new JobQueueError('JOB_NOT_FOUND', 404, 'Job not found.')
    throw new JobQueueError('JOB_STATE_CONFLICT', 409, 'Only queued jobs can be cancelled.')
  })
}

export function retryJob(db: Kysely<Database>, actor: string, id: string): Promise<Job> {
  return db.transaction().execute(async tx => {
    await requireLockedAdmin(tx, actor)
    const original = await tx.selectFrom('jobs').selectAll().where('id', '=', id).executeTakeFirst()
    if (!original) throw new JobQueueError('JOB_NOT_FOUND', 404, 'Job not found.')
    if (original.status !== 'failed') {
      throw new JobQueueError('JOB_STATE_CONFLICT', 409, 'Only failed jobs can be retried.')
    }
    // This handler is read-only. Future handlers with side effects must opt in
    // only after providing idempotency or fixed-version preconditions.
    if (original.kind !== 'storage.check') {
      throw new JobQueueError('JOB_NOT_RETRYABLE', 409, 'This job kind cannot be retried.')
    }
    let payload
    try {
      payload = validateJobPayload(original.kind, original.payload)
    } catch (error) {
      if (error instanceof JobValidationError) {
        throw new JobQueueError('INVALID_JOB_PAYLOAD', 400, error.message, error)
      }
      throw error
    }
    if (payload.spaceId !== undefined) {
      // Retain the original scope after ON DELETE SET NULL; never widen a
      // deleted Space check into a site-wide check. Hold off deletion until commit.
      const space = await tx.selectFrom('spaces').select('id')
        .where('id', '=', payload.spaceId).forKeyShare().executeTakeFirst()
      if (!space || original.space_id === null) {
        throw new JobQueueError('JOB_REFERENCE_NOT_FOUND', 400, 'The requested Space no longer exists.')
      }
    }
    if ((payload.spaceId ?? null) !== original.space_id) {
      throw new JobQueueError('INVALID_JOB_PAYLOAD', 400, 'The saved Job and Space references do not match.')
    }
    // The existing partial unique index also covers concurrent retry requests.
    return insertJob(tx, { kind: original.kind, payload, requestedByUserId: actor }, original.id)
  })
}

/** Call once before polling, after the previous single Server has stopped. */
export async function recoverInterruptedJobs(db: Kysely<Database>): Promise<bigint> {
  const result = await db.updateTable('jobs').set({
    status: 'failed',
    result: null,
    error_code: 'WORKER_INTERRUPTED',
    error_message: 'The server stopped before the job outcome was saved. Review and retry manually.',
    finished_at: sql<Date>`GREATEST(started_at, clock_timestamp())`,
  }).where('status', '=', 'running').executeTakeFirstOrThrow()
  return result.numUpdatedRows
}

async function requireLockedAdmin(tx: Transaction<Database>, actor: string) {
  // Keep admission and permission changes ordered until the mutation commits.
  await tx.selectFrom('users').select('id').where('id', '=', actor).forShare().executeTakeFirst()
  await requireSiteAdmin(tx, actor)
}

export async function succeedJob(db: Kysely<Database>, id: string, input: unknown): Promise<Job> {
  let result
  try {
    result = validateJobResult(input)
  } catch (error) {
    if (error instanceof JobValidationError) {
      throw new JobQueueError('INVALID_JOB_RESULT', 400, error.message, error)
    }
    throw error
  }

  try {
    const job = await db
      .updateTable('jobs')
      .set({
        status: 'succeeded',
        result,
        error_code: null,
        error_message: null,
        finished_at: sql<Date>`CURRENT_TIMESTAMP`,
      })
      .where('id', '=', id)
      .where('status', '=', 'running')
      .returningAll()
      .executeTakeFirst()
    if (!job) throw stateConflict()
    return job
  } catch (error) {
    if (error instanceof JobQueueError) throw error
    throw new JobQueueError('INTERNAL', 500, 'failed to save job result', error)
  }
}

export async function failJob(db: Kysely<Database>, id: string, input: FailJobInput): Promise<Job> {
  const code = input.code.trim()
  const message = input.message.trim()
  if (!/^[A-Z][A-Z0-9_]{0,99}$/.test(code) || !message || message.length > 2000) {
    throw new JobQueueError('INVALID_JOB_ERROR', 400, 'job error code or message is invalid')
  }

  try {
    const job = await db
      .updateTable('jobs')
      .set({
        status: 'failed',
        result: null,
        error_code: code,
        error_message: message,
        finished_at: sql<Date>`CURRENT_TIMESTAMP`,
      })
      .where('id', '=', id)
      .where('status', '=', 'running')
      .returningAll()
      .executeTakeFirst()
    if (!job) throw stateConflict()
    return job
  } catch (error) {
    if (error instanceof JobQueueError) throw error
    throw new JobQueueError('INTERNAL', 500, 'failed to save job failure', error)
  }
}

function stateConflict() {
  return new JobQueueError('JOB_STATE_CONFLICT', 409, 'job is not running')
}

function isPostgresError(error: unknown, code: string, constraint?: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === code
    && (constraint === undefined || ('constraint' in error && error.constraint === constraint))
}
