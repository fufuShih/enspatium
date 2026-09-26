import type { FastifyInstance } from 'fastify'

import type { Job } from '../../db/types/job.types.js'
import { requireSiteAdmin } from '../admin-users.js'
import { StorageBusyError } from '../space/storage-access.js'
import { JobExecutionError, runJobHandler } from './handlers.js'
import {
  claimNextJob,
  failJob,
  JobQueueError,
  succeedJob,
} from './queue.js'

export const defaultJobPollIntervalMilliseconds = 2_000

export class JobWorker {
  private closing = false
  private loopPromise: Promise<void> | undefined
  private wakePoll: (() => void) | undefined

  constructor(
    private readonly app: FastifyInstance,
    private readonly pollIntervalMilliseconds = defaultJobPollIntervalMilliseconds,
  ) {
    if (!Number.isFinite(pollIntervalMilliseconds) || pollIntervalMilliseconds < 1) {
      throw new TypeError('job poll interval must be a positive number')
    }
  }

  start() {
    if (this.loopPromise || this.closing) return
    this.loopPromise = this.runLoop()
  }

  async close() {
    this.closing = true
    this.wakePoll?.()
    await this.loopPromise
  }

  private async processNextJob(): Promise<boolean> {
    const job = await claimNextJob(this.app.db)
    if (!job) return false
    await this.runClaimedJob(job)
    return true
  }

  private async runLoop() {
    while (!this.closing) {
      try {
        await this.processNextJob()
      } catch (error) {
        this.app.log.error({ event: 'jobs.claim_failed', err: error }, 'Job worker could not claim work')
      }
      if (!this.closing) await this.waitForNextPoll()
    }
  }

  private async runClaimedJob(job: Job) {
    try {
      await this.requireCurrentPermission(job)
      const result = await runJobHandler({ db: this.app.db, dataRoot: this.app.config.DATA_ROOT }, job)
      await succeedJob(this.app.db, job.id, result)
      this.app.log.info({ event: 'job.succeeded', jobId: job.id, kind: job.kind }, 'Background job completed')
    } catch (error) {
      const failure = jobFailure(error)
      try {
        await failJob(this.app.db, job.id, failure)
      } catch (saveError) {
        this.app.log.error({ event: 'job.failure_save_failed', jobId: job.id, kind: job.kind, err: saveError }, 'Background job failure could not be saved')
        return
      }
      this.app.log.warn({ event: 'job.failed', jobId: job.id, kind: job.kind, code: failure.code, err: error }, 'Background job failed')
    }
  }

  private async requireCurrentPermission(job: Job) {
    if (!job.requested_by_user_id) {
      throw new JobExecutionError('REQUESTER_NOT_FOUND', 'The requesting user no longer exists.')
    }
    try {
      await requireSiteAdmin(this.app.db, job.requested_by_user_id)
    } catch (error) {
      if (isErrorCode(error, 'FORBIDDEN')) {
        throw new JobExecutionError('PERMISSION_REVOKED', 'The requesting user is no longer an active site administrator.', { cause: error })
      }
      throw error
    }
  }

  private waitForNextPoll() {
    return new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        this.wakePoll = undefined
        resolve()
      }, this.pollIntervalMilliseconds)
      timer.unref?.()
      this.wakePoll = () => {
        clearTimeout(timer)
        this.wakePoll = undefined
        resolve()
      }
    })
  }
}

function jobFailure(error: unknown): { code: string; message: string } {
  if (error instanceof JobExecutionError) return { code: error.code, message: error.message }
  if (error instanceof StorageBusyError) {
    return { code: error.code, message: 'Storage is busy. Create a new job after the active storage operation finishes.' }
  }
  if (error instanceof JobQueueError && error.code === 'INVALID_JOB_RESULT') {
    return { code: 'INVALID_JOB_RESULT', message: 'The job produced an invalid or oversized result.' }
  }
  if (error instanceof JobQueueError) {
    return { code: 'RESULT_SAVE_FAILED', message: 'The job result could not be saved.' }
  }
  return { code: 'JOB_EXECUTION_FAILED', message: 'The job could not finish. Review the server log before retrying.' }
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
