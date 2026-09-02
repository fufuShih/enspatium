import { Type } from '@sinclair/typebox'

export const UserResponseSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  email: Type.String(),
  displayName: Type.String(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
})

export const CreateUserBodySchema = Type.Object({
  email: Type.String({ minLength: 1, maxLength: 320 }),
  password: Type.String({ minLength: 8, maxLength: 1024 }),
  displayName: Type.String({ minLength: 1, maxLength: 100 }),
})

export const UserParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
})
