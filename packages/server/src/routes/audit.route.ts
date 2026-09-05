import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'

import { listSpaceAuditEvents } from '../services/audit/audit.js'
import { requireSpaceOwnerAccess } from '../services/space/space.js'
import {
  AuditEventListResponseSchema,
  AuditQuerySchema,
  AuditSpaceParamsSchema,
} from './types/audit.types.js'
import { requireCurrentUserId } from './current-user.route.js'

export const auditRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/namespaces/:namespaceSlug/spaces/:spaceSlug/audit-events',
    {
      schema: {
        operationId: 'listSpaceAuditEvents',
        tags: ['audit'],
        params: AuditSpaceParamsSchema,
        querystring: AuditQuerySchema,
        response: {
          200: AuditEventListResponseSchema,
        },
      },
    },
    async (request) => {
      const userId = requireCurrentUserId(request)
      const spaceAccess = await requireSpaceOwnerAccess(
        app.db,
        userId,
        request.params.namespaceSlug,
        request.params.spaceSlug,
      )

      return listSpaceAuditEvents(
        app.db,
        spaceAccess.spaceId,
        request.query.limit,
      )
    },
  )
}
