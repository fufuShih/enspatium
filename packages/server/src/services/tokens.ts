import { createHash, randomBytes } from 'node:crypto'
import type { Kysely } from 'kysely'

import type { Database } from '../db/index.js'
import {
  personalAccessTokenScopes,
  type AuthenticatedPersonalAccessToken,
  type CreatePersonalAccessTokenInput,
  type CreatedPersonalAccessToken,
  type PersonalAccessToken,
  type PersonalAccessTokenScope,
  type PublicPersonalAccessToken,
  type TokenServiceErrorCode,
} from '../db/token.types.js'

const tokenPattern = /^ensp_[A-Za-z0-9_-]{43}$/
const allowedScopes = new Set<string>(personalAccessTokenScopes)

type PublicPersonalAccessTokenRow = Pick<
  PersonalAccessToken,
  | 'id'
  | 'name'
  | 'scopes'
  | 'expires_at'
  | 'last_used_at'
  | 'revoked_at'
  | 'created_at'
>

interface NormalizedPersonalAccessTokenInput {
  name: string
  scopes: PersonalAccessTokenScope[]
  expiresAt: Date | null
}

export class TokenServiceError extends Error {
  constructor(
    readonly code: TokenServiceErrorCode,
    readonly statusCode: number,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause })
    this.name = 'TokenServiceError'
  }
}

export async function createPersonalAccessToken(
  db: Kysely<Database>,
  userId: string,
  input: CreatePersonalAccessTokenInput,
): Promise<CreatedPersonalAccessToken> {
  const normalized = validateCreatePersonalAccessToken(input)
  const token = generatePersonalAccessToken()

  try {
    const createdToken = await db
      .insertInto('personal_access_tokens')
      .values({
        user_id: userId,
        name: normalized.name,
        token_hash: hashPersonalAccessToken(token),
        scopes: normalized.scopes,
        expires_at: normalized.expiresAt,
      })
      .returning([
        'id',
        'name',
        'scopes',
        'expires_at',
        'last_used_at',
        'revoked_at',
        'created_at',
      ])
      .executeTakeFirstOrThrow()

    return {
      ...toPublicPersonalAccessToken(createdToken),
      token,
    }
  } catch (error) {
    throw new TokenServiceError(
      'INTERNAL',
      500,
      'failed to create personal access token',
      error,
    )
  }
}

export async function listPersonalAccessTokens(
  db: Kysely<Database>,
  userId: string,
): Promise<PublicPersonalAccessToken[]> {
  try {
    const tokens = await db
      .selectFrom('personal_access_tokens')
      .select([
        'id',
        'name',
        'scopes',
        'expires_at',
        'last_used_at',
        'revoked_at',
        'created_at',
      ])
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .execute()

    return tokens.map(toPublicPersonalAccessToken)
  } catch (error) {
    throw new TokenServiceError(
      'INTERNAL',
      500,
      'failed to list personal access tokens',
      error,
    )
  }
}

export async function revokePersonalAccessToken(
  db: Kysely<Database>,
  userId: string,
  tokenId: string,
): Promise<void> {
  let revokedToken: { id: string } | undefined

  try {
    revokedToken = await db
      .updateTable('personal_access_tokens')
      .set({ revoked_at: new Date() })
      .where('id', '=', tokenId)
      .where('user_id', '=', userId)
      .returning('id')
      .executeTakeFirst()
  } catch (error) {
    throw new TokenServiceError(
      'INTERNAL',
      500,
      'failed to revoke personal access token',
      error,
    )
  }

  if (!revokedToken) {
    throw new TokenServiceError(
      'NOT_FOUND',
      404,
      'personal access token not found',
    )
  }
}

export async function authenticatePersonalAccessToken(
  db: Kysely<Database>,
  inputToken: string,
  requiredScope: PersonalAccessTokenScope,
): Promise<AuthenticatedPersonalAccessToken> {
  if (!tokenPattern.test(inputToken)) {
    throw invalidToken()
  }

  let token:
    | Pick<
        PersonalAccessToken,
        'id' | 'user_id' | 'scopes' | 'expires_at' | 'revoked_at'
      >
    | undefined

  try {
    token = await db
      .selectFrom('personal_access_tokens')
      .select(['id', 'user_id', 'scopes', 'expires_at', 'revoked_at'])
      .where('token_hash', '=', hashPersonalAccessToken(inputToken))
      .executeTakeFirst()
  } catch (error) {
    throw new TokenServiceError(
      'INTERNAL',
      500,
      'failed to authenticate personal access token',
      error,
    )
  }

  if (
    !token ||
    token.revoked_at !== null ||
    (token.expires_at !== null && token.expires_at.getTime() <= Date.now())
  ) {
    throw invalidToken()
  }

  if (!token.scopes.includes(requiredScope)) {
    throw new TokenServiceError(
      'INSUFFICIENT_SCOPE',
      403,
      'personal access token does not have the required scope',
    )
  }

  try {
    await db
      .updateTable('personal_access_tokens')
      .set({ last_used_at: new Date() })
      .where('id', '=', token.id)
      .executeTakeFirst()
  } catch (error) {
    throw new TokenServiceError(
      'INTERNAL',
      500,
      'failed to update personal access token usage',
      error,
    )
  }

  return {
    id: token.id,
    userId: token.user_id,
    scopes: token.scopes,
  }
}

export function generatePersonalAccessToken(): string {
  return 'ensp_' + randomBytes(32).toString('base64url')
}

export function hashPersonalAccessToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function validateCreatePersonalAccessToken(
  input: CreatePersonalAccessTokenInput,
): NormalizedPersonalAccessTokenInput {
  const name = input.name.trim()

  if (!name) {
    throw new TokenServiceError('INVALID_INPUT', 400, 'token name is required')
  }

  if (name.length > 100) {
    throw new TokenServiceError(
      'INVALID_INPUT',
      400,
      'token name must contain at most 100 characters',
    )
  }

  if (input.scopes.length === 0) {
    throw new TokenServiceError(
      'INVALID_INPUT',
      400,
      'at least one token scope is required',
    )
  }

  const uniqueScopes = new Set(input.scopes)

  if (
    uniqueScopes.size !== input.scopes.length ||
    input.scopes.some((scope) => !allowedScopes.has(scope))
  ) {
    throw new TokenServiceError(
      'INVALID_INPUT',
      400,
      'token scopes are invalid',
    )
  }

  let expiresAt: Date | null = null

  if (input.expiresAt !== undefined) {
    expiresAt = new Date(input.expiresAt)

    if (
      Number.isNaN(expiresAt.getTime()) ||
      expiresAt.getTime() <= Date.now()
    ) {
      throw new TokenServiceError(
        'INVALID_INPUT',
        400,
        'token expiration must be a future date',
      )
    }
  }

  return {
    name,
    scopes: [...input.scopes],
    expiresAt,
  }
}

function toPublicPersonalAccessToken(
  token: PublicPersonalAccessTokenRow,
): PublicPersonalAccessToken {
  return {
    id: token.id,
    name: token.name,
    scopes: token.scopes,
    expiresAt: token.expires_at?.toISOString() ?? null,
    lastUsedAt: token.last_used_at?.toISOString() ?? null,
    revokedAt: token.revoked_at?.toISOString() ?? null,
    createdAt: token.created_at.toISOString(),
  }
}

function invalidToken(): TokenServiceError {
  return new TokenServiceError(
    'INVALID_TOKEN',
    401,
    'invalid personal access token',
  )
}
