import { Type } from '@sinclair/typebox'

export const LoginBodySchema = Type.Object({
  email: Type.String({ minLength: 1, maxLength: 320 }),
  password: Type.String({ minLength: 1, maxLength: 1024 }),
})
