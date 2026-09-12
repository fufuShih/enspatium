import { Type } from '@sinclair/typebox'
import { UserResponseSchema } from './users.types.js'

export const SessionUserResponseSchema = Type.Object({
  ...UserResponseSchema.properties,
  isAdmin: Type.Boolean(),
})

export const LoginBodySchema = Type.Object({
  email: Type.String({ minLength: 1, maxLength: 320 }),
  password: Type.String({ minLength: 1, maxLength: 1024 }),
})
