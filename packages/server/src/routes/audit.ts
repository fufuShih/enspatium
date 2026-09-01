import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'

import {
  listSpaceAuditEvents,
  maximumAuditEventLimit,
} from '../services/audit/audit.js'
import { requireSpaceOwnerAccess } from '../services/space/space.js'
import { requireCurrentUserId } from './current-user.js'

const SpaceParamsSchema = Type.Object({
  namespaceSlug: Type.String({ minLength: 1, maxLength: 100 }),
  spaceSlug: Type.String({ minLength: 1, maxLength: 100 }),
})

const AuditQuerySchema = Type.Object({
  limit: Type.Optional(
    Type.Integer({ minimum: 1, maximum: maximumAuditEventLimit }),
  ),
})

const AuditActionSchema = Type.Union([
  Type.Literal('space.created'),
  Type.Literal('space.updated'),
  Type.Literal('space.deleted'),
  Type.Literal('git.pushed'),
])

const AuditEventResponseSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  actorUserId: Type.Union([
    Type.String({ format: 'uuid' }),
    Type.Null(),
  ]),
  namespaceId: Type.Union([
    Type.String({ format: 'uuid' }),
    Type.Null(),
  ]),
  spaceId: Type.Union([
    Type.String({ format: 'uuid' }),
    Type.Null(),
  ]),
  action: AuditActionSchema,
  metadata: Type.Record(Type.String(), Type.Unknown()),
  createdAt: Type.String({ format: 'date-time' }),
})

export const auditRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/namespaces/:namespaceSlug/spaces/:spaceSlug/audit-events',
    {
      schema: {
        params: SpaceParamsSchema,
        querystring: AuditQuerySchema,
        response: {
          200: Type.Array(AuditEventResponseSchema),
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
