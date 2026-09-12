import { Type } from '@sinclair/typebox'

export const GitMaintenanceJobSchema = Type.Object({
  id: Type.String({ format: 'uuid' }), spaceId: Type.String({ format: 'uuid' }), repository: Type.String(),
  status: Type.Union([Type.Literal('running'), Type.Literal('completed'), Type.Literal('failed')]),
  phase: Type.Union([Type.Literal('checking'), Type.Literal('compacting'), Type.Literal('verifying'), Type.Literal('finished')]),
  startedAt: Type.String({ format: 'date-time' }), finishedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  beforeBytes: Type.Union([Type.Number(), Type.Null()]), afterBytes: Type.Union([Type.Number(), Type.Null()]),
  message: Type.String(), auditRecorded: Type.Boolean(),
})
export const GitMaintenanceStatusSchema = Type.Object({ job: Type.Union([GitMaintenanceJobSchema, Type.Null()]) })
export const GitMaintenanceBodySchema = Type.Object({ spaceId: Type.String({ format: 'uuid' }) }, { additionalProperties: false })
export const AdminGitSpacesQuerySchema = Type.Object({
  search: Type.Optional(Type.String({ maxLength: 100 })), cursor: Type.Optional(Type.String({ format: 'uuid' })),
})
export const AdminGitSpacesSchema = Type.Object({
  spaces: Type.Array(Type.Object({ id: Type.String({ format: 'uuid' }), namespace: Type.String(), slug: Type.String(), name: Type.String() })),
  nextCursor: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
})
