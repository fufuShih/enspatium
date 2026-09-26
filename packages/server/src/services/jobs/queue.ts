import { sql, type Kysely } from 'kysely'

import type { Database } from '../../db/index.js'
import type {
  Job,
  JobQueueErrorCode,
} from '../../db/types/job.types.js'
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

export async function createJob(db: Kysely<Database>, input: CreateJobInput): Promise<Job> {
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
        retry_of_job_id: null,
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
      .forUpdate()
      .skipLocked()
      .executeTakeFirst()

    if (!candidate) return undefined

    return transaction
      .updateTable('jobs')
      .set({ status: 'running', started_at: sql<Date>`CURRENT_TIMESTAMP` })
      .where('id', '=', candidate.id)
      .where('status', '=', 'queued')
      .returningAll()
      .executeTakeFirstOrThrow()
  })
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
