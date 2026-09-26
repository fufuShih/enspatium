import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { sql } from 'kysely'
import type { Job } from '../db/types/job.types.js'
import type { StorageCheckReport } from '../services/storage-check/report.js'
import { requireSiteAdmin } from '../services/admin-users.js'
import { cancelJob, createAdminJob, JobQueueError, retryJob } from '../services/jobs/queue.js'
import { isJobKind, JobValidationError, validateJobPayload } from '../services/jobs/registry.js'
import { requireCurrentUserId } from './current-user.route.js'
import { AdminErrorSchema } from './types/admin.types.js'
import { CreateJobBodySchema, JobDetailSchema, JobListSchema, JobParamsSchema, ListJobsQuerySchema } from './types/jobs.types.js'

const errors = { 400: AdminErrorSchema, 401: AdminErrorSchema, 403: AdminErrorSchema, 404: AdminErrorSchema, 409: AdminErrorSchema }
const common = { tags: ['admin'], security: [{ session: [] }] }
const summaryColumns = ['id', 'kind', 'space_id', 'requested_by_user_id', 'status', 'payload', 'retry_of_job_id', 'created_at', 'started_at', 'finished_at', 'error_code', 'error_message'] as const

export const adminJobRoutes: FastifyPluginAsyncTypebox = async app => {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('cache-control', 'private, no-store')
    await requireSiteAdmin(app.db, requireCurrentUserId(request))
    if (request.method === 'POST' && request.headers.origin !== undefined && request.headers.origin !== `${request.protocol}://${request.host}`) {
      throw Object.assign(new Error('A same-origin request is required.'), { statusCode: 403, code: 'FORBIDDEN' })
    }
  })
  app.get('/admin/jobs', { schema: {
    ...common, operationId: 'listAdminJobs', querystring: ListJobsQuerySchema,
    description: 'Newest jobs first, with optional status filtering and cursor pagination (default 30). Reports are only returned by the detail endpoint.',
    response: { 200: JobListSchema, ...errors },
  } }, async request => {
    const { status, cursor, limit = 30 } = request.query
    let query = app.db.selectFrom('jobs').select(summaryColumns).orderBy('created_at', 'desc').orderBy('id', 'desc').limit(limit + 1)
    if (status) query = query.where('status', '=', status)
    if (cursor) {
      // Keep PostgreSQL's microsecond precision; a JS Date would skip rows.
      const anchor = await app.db.selectFrom('jobs').select(sql<string>`created_at::text`.as('at')).where('id', '=', cursor).executeTakeFirst()
      if (!anchor) throw new JobQueueError('INVALID_JOB_CURSOR', 400, 'The pagination cursor no longer exists. Refresh the list.')
      const at = sql<Date>`${anchor.at}::timestamptz`
      query = query.where(eb => eb.or([eb('created_at', '<', at), eb.and([eb('created_at', '=', at), eb('id', '<', cursor)])]))
    }
    const rows = await query.execute()
    return { jobs: rows.slice(0, limit).map(summary), nextCursor: rows.length > limit ? rows[limit - 1]!.id : null }
  })
  app.post('/admin/jobs', { preValidation: async request => {
    // Validate before AJV's default coercion/removal of additional properties.
    const body = request.body
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'kind' && key !== 'payload')) {
      throw new JobQueueError('INVALID_JOB_PAYLOAD', 400, 'Expected a job kind and payload.')
    }
    if (!isJobKind(body.kind)) throw new JobQueueError('INVALID_JOB_KIND', 400, 'Unknown job kind.')
    try { validateJobPayload(body.kind, body.payload) } catch (error) {
      if (error instanceof JobValidationError) throw new JobQueueError('INVALID_JOB_PAYLOAD', 400, error.message)
      throw error
    }
  }, schema: {
    ...common, operationId: 'createAdminJob', body: CreateJobBodySchema,
    description: 'Queue a read-only storage check. Only one storage check may be queued or running. Execution continues after the request ends.',
    response: { 202: JobDetailSchema, ...errors },
  } }, async (request, reply) => reply.code(202).send(detail(await createAdminJob(app.db, { ...request.body, requestedByUserId: requireCurrentUserId(request) }))))
  app.get('/admin/jobs/:id', { schema: {
    ...common, operationId: 'getAdminJob', params: JobParamsSchema,
    description: 'Persisted job state and report. A succeeded job may contain findings or an incomplete report. Poll unfinished jobs every two seconds.',
    response: { 200: JobDetailSchema, ...errors },
  } }, async request => {
    const job = await app.db.selectFrom('jobs').selectAll().where('id', '=', request.params.id).executeTakeFirst()
    if (!job) throw new JobQueueError('JOB_NOT_FOUND', 404, 'Job not found.')
    return detail(job)
  })
  app.post('/admin/jobs/:id/cancel', { schema: {
    ...common, operationId: 'cancelAdminJob', params: JobParamsSchema,
    description: 'Cancel a queued job. Running and terminal jobs cannot be cancelled.',
    response: { 200: JobDetailSchema, ...errors },
  } }, async request => detail(await cancelJob(app.db, requireCurrentUserId(request), request.params.id)))
  app.post('/admin/jobs/:id/retry', { schema: {
    ...common, operationId: 'retryAdminJob', params: JobParamsSchema,
    description: 'Create a new job from a failed read-only storage check. Preserve the original history and scope; do not automatically retry.',
    response: { 202: JobDetailSchema, ...errors },
  } }, async (request, reply) => reply.code(202).send(detail(await retryJob(app.db, requireCurrentUserId(request), request.params.id))))
}

function summary(job: Omit<Job, 'result'>) {
  return {
    id: job.id, kind: job.kind, spaceId: job.space_id, requestedByUserId: job.requested_by_user_id,
    status: job.status, payload: job.payload, retryOfJobId: job.retry_of_job_id,
    createdAt: job.created_at.toISOString(), startedAt: job.started_at?.toISOString() ?? null,
    finishedAt: job.finished_at?.toISOString() ?? null, errorCode: job.error_code, errorMessage: job.error_message,
    canCancel: job.status === 'queued', canRetry: job.status === 'failed' && job.kind === 'storage.check',
  }
}

function detail(job: Job) {
  // The registered storage.check handler persists a StorageCheckReport.
  return { ...summary(job), result: job.result as StorageCheckReport | null }
}
