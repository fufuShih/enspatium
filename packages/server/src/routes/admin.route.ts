import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { requireCurrentUserId } from './current-user.route.js'
import {
  StorageCheckBodySchema,
  StorageCheckReportSchema,
  AdminErrorSchema,
} from './types/admin.types.js'
import { checkStorage } from '../services/storage-check/index.js'
import { requireSiteAdmin } from '../services/admin-users.js'
import { OperationsStatusSchema } from './types/operations.types.js'
import { AdminGitSpacesQuerySchema, AdminGitSpacesSchema, GitMaintenanceBodySchema, GitMaintenanceJobSchema, GitMaintenanceStatusSchema } from './types/git-maintenance.types.js'

export const adminRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('cache-control', 'private, no-store')
    // Read the current role for every request, including polling requests.
    await requireSiteAdmin(app.db, requireCurrentUserId(request))
  })
  app.get('/admin/operations', {
    schema: {
      operationId: 'getOperationsStatus', tags: ['admin'], security: [{ session: [] }],
      description: 'Site admins only. Database/storage probes, Git capacity and the latest 20 sanitized error summaries from this backend process. Counters reset on restart. Degraded probes return HTTP 200 with status degraded.',
      response: { 200: OperationsStatusSchema, 401: AdminErrorSchema, 403: AdminErrorSchema },
    },
  }, async () => app.operations.refresh())
  app.get('/admin/git/spaces', {
    schema: {
      operationId: 'listAdminGitSpaces', tags: ['admin'], security: [{ session: [] }],
      querystring: AdminGitSpacesQuerySchema,
      response: { 200: AdminGitSpacesSchema, 401: AdminErrorSchema, 403: AdminErrorSchema },
    },
  }, async request => {
    let query = app.db.selectFrom('spaces as s').innerJoin('namespaces as n', 'n.id', 's.namespace_id')
      .select(['s.id', 's.slug', 's.name', 'n.slug as namespace']).where('s.type', '=', 'git').orderBy('s.id').limit(31)
    if (request.query.cursor) query = query.where('s.id', '>', request.query.cursor)
    if (request.query.search?.trim()) {
      const pattern = `%${request.query.search.trim().replace(/[\\%_]/g, '\\$&')}%`
      query = query.where(eb => eb.or([eb('s.name', 'ilike', pattern), eb('s.slug', 'ilike', pattern), eb('n.slug', 'ilike', pattern)]))
    }
    const rows = await query.execute()
    return { spaces: rows.slice(0, 30), nextCursor: rows.length > 30 ? rows[29]!.id : null }
  })
  app.get('/admin/git/maintenance', {
    schema: {
      operationId: 'getGitMaintenance', tags: ['admin'], security: [{ session: [] }],
      description: 'Current or last maintenance job in this backend process. Completion audits persist across restarts.',
      response: { 200: GitMaintenanceStatusSchema, 401: AdminErrorSchema, 403: AdminErrorSchema },
    },
  }, async () => app.gitMaintenance.getStatus())
  app.post('/admin/git/maintenance', {
    schema: {
      operationId: 'startGitMaintenance', tags: ['admin'], security: [{ session: [] }],
      description: 'Site admins only. Start one background integrity check, conservative GC and verification. Storage writes pause until completion. Git reads also pause during compaction and verification. Runs independently of the HTTP connection; poll GET for the outcome.',
      body: GitMaintenanceBodySchema,
      response: { 202: GitMaintenanceJobSchema, 401: AdminErrorSchema, 403: AdminErrorSchema, 404: AdminErrorSchema, 409: AdminErrorSchema, 503: AdminErrorSchema },
    },
  }, async (request, reply) => reply.code(202).send(await app.gitMaintenance.start(request.body.spaceId, requireCurrentUserId(request))))
  app.post(
    '/admin/storage/check',
    {
      schema: {
        operationId: 'checkStorageIntegrity',
        tags: ['admin'],
        security: [{ session: [] }],
        description:
          'Site admins only. Run a read-only storage check and return the report. Storage writes are paused in this backend process until checking finishes; reads remain available. Returns 409 if writes or another check are active. Findings use HTTP 200 with status issues/incomplete. Requests have a two-minute scan budget; direct filesystem edits and multiple backend processes are outside the write guard.',
        body: StorageCheckBodySchema,
        response: {
          200: StorageCheckReportSchema,
          401: AdminErrorSchema,
          403: AdminErrorSchema,
          409: AdminErrorSchema,
        },
      },
    },
    async (request) => checkStorage(app.db, app.config.DATA_ROOT, request.body),
  )
}
