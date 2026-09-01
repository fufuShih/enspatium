import type { Generated, Insertable, Selectable } from 'kysely'

export const personalAccessTokenScopes = ['git:read', 'git:write'] as const

export type PersonalAccessTokenScope =
  (typeof personalAccessTokenScopes)[number]

export interface PersonalAccessTokenTable {
  id: Generated<string>
  user_id: string
  name: string
  token_hash: string
  scopes: PersonalAccessTokenScope[]
  expires_at: Date | null
  last_used_at: Generated<Date | null>
  revoked_at: Generated<Date | null>
  created_at: Generated<Date>
}

export type PersonalAccessToken = Selectable<PersonalAccessTokenTable>
export type NewPersonalAccessToken = Insertable<PersonalAccessTokenTable>

export interface PublicPersonalAccessToken {
  id: string
  name: string
  scopes: PersonalAccessTokenScope[]
  expiresAt: string | null
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}

export interface CreatedPersonalAccessToken
  extends PublicPersonalAccessToken {
  token: string
}

export interface CreatePersonalAccessTokenInput {
  name: string
  scopes: PersonalAccessTokenScope[]
  expiresAt?: string
}

export interface AuthenticatedPersonalAccessToken {
  id: string
  userId: string
  scopes: PersonalAccessTokenScope[]
}

export type TokenServiceErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_TOKEN'
  | 'INSUFFICIENT_SCOPE'
  | 'NOT_FOUND'
  | 'INTERNAL'
