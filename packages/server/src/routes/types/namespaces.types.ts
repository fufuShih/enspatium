import { Type } from '@sinclair/typebox'

export const NamespaceResponseSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  ownerUserId: Type.String({ format: 'uuid' }),
  name: Type.String(),
  slug: Type.String(),
  kind: Type.Union([
    Type.Literal('personal'),
    Type.Literal('organization'),
  ]),
  createdAt: Type.String(),
})

export const NamespaceListResponseSchema = Type.Array(
  NamespaceResponseSchema,
)

export const CreateOrganizationNamespaceBodySchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
  slug: Type.String({ minLength: 1, maxLength: 100 }),
})

export const NamespaceParamsSchema = Type.Object({
  slug: Type.String({ minLength: 1, maxLength: 100 }),
})

export const NamespaceMemberParamsSchema = Type.Object({
  slug: Type.String({ minLength: 1, maxLength: 100 }),
  userId: Type.String({ format: 'uuid' }),
})

export const AddNamespaceMemberBodySchema = Type.Object({
  email: Type.String({ minLength: 1, maxLength: 320 }),
})

export const NamespaceMemberResponseSchema = Type.Object({
  userId: Type.String({ format: 'uuid' }),
  email: Type.String(),
  displayName: Type.String(),
  role: Type.Union([Type.Literal('owner'), Type.Literal('member')]),
  joinedAt: Type.String(),
})

export const NamespaceMemberListResponseSchema = Type.Array(
  NamespaceMemberResponseSchema,
)
