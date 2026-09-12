import { Type } from '@sinclair/typebox'

export const StorageCheckBodySchema = Type.Object(
  {
    spaceId: Type.Optional(Type.String({ format: 'uuid' })),
    deep: Type.Optional(Type.Boolean({ default: false })),
  },
  { additionalProperties: false },
)

export const StorageCheckReportSchema = Type.Object({
  startedAt: Type.String({ format: 'date-time' }),
  finishedAt: Type.String({ format: 'date-time' }),
  mode: Type.Union([Type.Literal('basic'), Type.Literal('deep')]),
  dataRoot: Type.String(),
  scope: Type.String(),
  consistency: Type.Literal('service-writes-paused'),
  complete: Type.Boolean(),
  status: Type.Union([
    Type.Literal('ok'),
    Type.Literal('issues'),
    Type.Literal('incomplete'),
  ]),
  spaces: Type.Array(
    Type.Object({
      id: Type.String({ format: 'uuid' }),
      namespace: Type.String(),
      slug: Type.String(),
      type: Type.Union([Type.Literal('git'), Type.Literal('object')]),
      objects: Type.Integer(),
      versions: Type.Integer(),
      filesChecked: Type.Integer(),
      hashesChecked: Type.Integer(),
      versionBytes: Type.String(),
    }),
  ),
  issues: Type.Array(
    Type.Object({
      severity: Type.Union([
        Type.Literal('info'),
        Type.Literal('warning'),
        Type.Literal('error'),
      ]),
      code: Type.String(),
      message: Type.String(),
      spaceId: Type.Optional(Type.String()),
      objectId: Type.Optional(Type.String()),
      versionId: Type.Optional(Type.String()),
      key: Type.Optional(Type.String()),
      path: Type.Optional(Type.String()),
      detail: Type.Optional(Type.String()),
    }),
  ),
})

export const AdminErrorSchema = Type.Object({
  statusCode: Type.Integer(),
  code: Type.String(),
  error: Type.String(),
  message: Type.String(),
})
