import type {
  Generated,
  Insertable,
  JSONColumnType,
  Selectable,
  Updateable,
} from 'kysely'

export const jobStatuses = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const

export type JobStatus = (typeof jobStatuses)[number]
export type JobKind = 'storage.check'

export type JobJsonValue =
  | null
  | boolean
  | number
  | string
  | JobJsonValue[]
  | { [key: string]: JobJsonValue }

export type JobJsonObject = { [key: string]: JobJsonValue }

export interface StorageCheckJobPayload extends JobJsonObject {
  deep: boolean
  spaceId?: string
}

export type JobPayload = StorageCheckJobPayload
export type JobResult = JobJsonObject

export interface JobTable {
  id: Generated<string>
  kind: JobKind
  space_id: string | null
  requested_by_user_id: string | null
  status: Generated<JobStatus>
  payload: JSONColumnType<JobPayload, JobPayload, JobPayload>
  result: JSONColumnType<JobResult | null, JobResult | null, JobResult | null>
  error_code: string | null
  error_message: string | null
  retry_of_job_id: string | null
  created_at: Generated<Date>
  started_at: Generated<Date | null>
  finished_at: Generated<Date | null>
}

export type Job = Selectable<JobTable>
export type NewJob = Insertable<JobTable>
export type JobUpdate = Updateable<JobTable>

export type JobQueueErrorCode =
  | 'INVALID_JOB_KIND'
  | 'INVALID_JOB_PAYLOAD'
  | 'INVALID_JOB_RESULT'
  | 'INVALID_JOB_ERROR'
  | 'JOB_ALREADY_PENDING'
  | 'JOB_REFERENCE_NOT_FOUND'
  | 'JOB_STATE_CONFLICT'
  | 'INTERNAL'
