import { Type } from '@sinclair/typebox'

export const PersonalAccessTokenScopeSchema = Type.Union([
  Type.Literal('git:read'),
  Type.Literal('git:write'),
])

const PersonalAccessTokenResponseProperties = {
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  scopes: Type.Array(PersonalAccessTokenScopeSchema),
  expiresAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  lastUsedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  revokedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
}

export const PersonalAccessTokenResponseSchema = Type.Object(
  PersonalAccessTokenResponseProperties,
)

export const PersonalAccessTokenListResponseSchema = Type.Array(
  PersonalAccessTokenResponseSchema,
)

export const CreatedPersonalAccessTokenResponseSchema = Type.Object({
  ...PersonalAccessTokenResponseProperties,
  token: Type.String(),
})

export const CreatePersonalAccessTokenBodySchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
  scopes: Type.Array(PersonalAccessTokenScopeSchema, {
    minItems: 1,
    maxItems: 2,
    uniqueItems: true,
  }),
  expiresAt: Type.Optional(Type.String({ format: 'date-time' })),
})

export const PersonalAccessTokenParamsSchema = Type.Object({
  tokenId: Type.String({ format: 'uuid' }),
})
