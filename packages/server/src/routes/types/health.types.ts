import { Type } from '@sinclair/typebox'

export const HealthResponseSchema = Type.Object({
  status: Type.Literal('ok'),
})
