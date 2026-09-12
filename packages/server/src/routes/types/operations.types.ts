import { Type } from '@sinclair/typebox'

export const OperationsStatusSchema = Type.Object({
  status: Type.Union([Type.Literal('ok'), Type.Literal('degraded')]),
  checkedAt: Type.String({ format: 'date-time' }),
  startedAt: Type.String({ format: 'date-time' }),
  uptimeSeconds: Type.Integer({ minimum: 0 }),
  databaseReady: Type.Boolean(),
  storage: Type.Object({
    available: Type.Boolean(),
    freeBytes: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    minimumFreeBytes: Type.Integer({ minimum: 0 }),
  }),
  git: Type.Object({ active: Type.Integer({ minimum: 0 }), maximum: Type.Integer({ minimum: 1 }) }),
  errors: Type.Object({
    total: Type.Integer({ minimum: 0 }),
    recent: Type.Array(Type.Object({
      at: Type.String({ format: 'date-time' }),
      kind: Type.Union([Type.Literal('http'), Type.Literal('git'), Type.Literal('cleanup')]),
      route: Type.Union([Type.String(), Type.Null()]),
      statusCode: Type.Union([Type.Integer({ minimum: 500, maximum: 599 }), Type.Null()]),
    }), { maxItems: 20 }),
  }),
  alerts: Type.Array(Type.Union([
    Type.Literal('database-unavailable'), Type.Literal('storage-unavailable'),
    Type.Literal('low-disk-space'), Type.Literal('recent-server-errors'),
  ])),
})
