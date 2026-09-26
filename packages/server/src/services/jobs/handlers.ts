import type { Kysely } from 'kysely'

import type { Database } from '../../db/index.js'
import type { Job, JobJsonObject, JobKind } from '../../db/types/job.types.js'
import { checkStorage } from '../storage-check/index.js'
import { isJobKind, JobValidationError, validateJobPayload } from './registry.js'

export interface JobHandlerContext {
  db: Kysely<Database>
  dataRoot: string
}

interface RegisteredJobHandler {
  timeoutMilliseconds: number
  run(context: JobHandlerContext, payload: JobJsonObject, signal: AbortSignal): Promise<unknown>
}

export class JobExecutionError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'JobExecutionError'
  }
}

const handlers: Record<JobKind, RegisteredJobHandler> = {
  'storage.check': {
    timeoutMilliseconds: 120_000,
    run: async (context, payload, signal) => {
      const report = await checkStorage(context.db, context.dataRoot, {
        deep: payload.deep as boolean,
        ...(payload.spaceId === undefined ? {} : { spaceId: payload.spaceId as string }),
      }, signal)
      if (payload.spaceId !== undefined && report.issues.some(issue => issue.code === 'SPACE_NOT_FOUND')) {
        throw new JobExecutionError('SPACE_NOT_FOUND', 'The requested Space no longer exists.')
      }
      return report
    },
  },
}

export async function runJobHandler(context: JobHandlerContext, job: Job): Promise<unknown> {
  if (!isJobKind(job.kind)) {
    throw new JobExecutionError('UNKNOWN_JOB_KIND', 'The requested job kind is not installed.')
  }

  let payload
  try {
    payload = validateJobPayload(job.kind, job.payload)
  } catch (error) {
    if (error instanceof JobValidationError) {
      throw new JobExecutionError('INVALID_JOB_PAYLOAD', 'The saved job payload is invalid.', { cause: error })
    }
    throw error
  }

  const payloadSpaceId = 'spaceId' in payload ? payload.spaceId : undefined
  if (payloadSpaceId !== undefined && job.space_id === null) {
    throw new JobExecutionError('SPACE_NOT_FOUND', 'The requested Space no longer exists.')
  }
  if ((payloadSpaceId ?? null) !== job.space_id) {
    throw new JobExecutionError('INVALID_JOB_PAYLOAD', 'The saved Job and Space references do not match.')
  }

  const handler = handlers[job.kind]
  const signal = AbortSignal.timeout(handler.timeoutMilliseconds)
  return handler.run(context, payload, signal)
}
