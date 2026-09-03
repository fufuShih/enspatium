import { Type } from '@sinclair/typebox'

import { maximumAuditEventLimit } from '../../services/audit/audit.js'

export const AuditSpaceParamsSchema = Type.Object({
  namespaceSlug: Type.String({ minLength: 1, maxLength: 100 }),
  spaceSlug: Type.String({ minLength: 1, maxLength: 100 }),
})

export const AuditQuerySchema = Type.Object({
  limit: Type.Optional(
    Type.Integer({ minimum: 1, maximum: maximumAuditEventLimit }),
  ),
})

export const AuditActionSchema = Type.Union([
  Type.Literal('space.created'),
  Type.Literal('space.updated'),
  Type.Literal('space.deleted'),
  Type.Literal('git.pushed'),
  Type.Literal('object.uploaded'),
  Type.Literal('object.deleted'),
])

export const AuditEventResponseSchema = Type.Object({
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

export const AuditEventListResponseSchema = Type.Array(
  AuditEventResponseSchema,
)
