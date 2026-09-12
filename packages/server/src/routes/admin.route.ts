import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { requireCurrentUserId } from './current-user.route.js'
import {
  StorageCheckBodySchema,
  StorageCheckReportSchema,
  AdminErrorSchema,
} from './types/admin.types.js'
import { checkStorage } from '../services/storage-check/index.js'
import { requireSiteAdmin } from '../services/admin-users.js'

export const adminRoutes: FastifyPluginAsyncTypebox = async (app) => {
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
      onRequest: async (request, reply) => {
        reply.header('cache-control', 'private, no-store')
        const userId = requireCurrentUserId(request)
        // Always read the current role; a stale session cannot retain revoked admin access.
        await requireSiteAdmin(app.db, userId)
      },
    },
    async (request) => checkStorage(app.db, app.config.DATA_ROOT, request.body),
  )
}
