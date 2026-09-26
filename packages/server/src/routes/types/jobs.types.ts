import { Type } from '@sinclair/typebox'
import { StorageCheckBodySchema, StorageCheckReportSchema } from './admin.types.js'

const nullableId = Type.Union([Type.String({ format: 'uuid' }), Type.Null()])
const nullableTime = Type.Union([Type.String({ format: 'date-time' }), Type.Null()])
export const JobStatusSchema = Type.Union([
  Type.Literal('queued'), Type.Literal('running'), Type.Literal('succeeded'), Type.Literal('failed'), Type.Literal('cancelled'),
])
export const JobParamsSchema = Type.Object({ id: Type.String({ format: 'uuid' }) })
export const ListJobsQuerySchema = Type.Object({
  status: Type.Optional(JobStatusSchema),
  cursor: Type.Optional(Type.String({ format: 'uuid' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 30 })),
}, { additionalProperties: false })
export const CreateJobBodySchema = Type.Object({
  kind: Type.Literal('storage.check'),
  payload: StorageCheckBodySchema,
}, { additionalProperties: false })
export const JobSummarySchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  kind: Type.String(),
  spaceId: nullableId,
  requestedByUserId: nullableId,
  status: JobStatusSchema,
  payload: StorageCheckBodySchema,
  retryOfJobId: nullableId,
  createdAt: Type.String({ format: 'date-time' }),
  startedAt: nullableTime,
  finishedAt: nullableTime,
  errorCode: Type.Union([Type.String(), Type.Null()]),
  errorMessage: Type.Union([Type.String(), Type.Null()]),
  canCancel: Type.Boolean(),
  canRetry: Type.Boolean(),
})
export const JobDetailSchema = Type.Composite([JobSummarySchema, Type.Object({
  result: Type.Union([StorageCheckReportSchema, Type.Null()]),
})])
export const JobListSchema = Type.Object({
  jobs: Type.Array(JobSummarySchema),
  nextCursor: nullableId,
})
