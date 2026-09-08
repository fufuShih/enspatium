import type { CreatePersonalAccessTokenBody, ListPersonalAccessTokens200Item } from '../../api/generated/api.schemas.ts'
import { apiStatus } from '../../context/session.ts'

export const accessTokensPath = '/settings/access-tokens'

export function newTokenInput(name: string, write: boolean, days: number, now = Date.now()): CreatePersonalAccessTokenBody {
  return {
    name: name.trim(),
    scopes: write ? ['git:read', 'git:write'] : ['git:read'],
    ...(days > 0 ? { expiresAt: new Date(now + days * 86_400_000).toISOString() } : {}),
  }
}

export function tokenStatus(token: ListPersonalAccessTokens200Item, now = Date.now()) {
  if (token.revokedAt) return 'Revoked'
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= now) return 'Expired'
  return 'Active'
}

export function tokenErrorMessage(error: unknown) {
  switch (apiStatus(error)) {
    case 400: return 'Please check the token name, permissions, and expiration.'
    case 401: return 'Your session has expired. Please sign in again.'
    case 403: return 'You do not have permission to manage this token.'
    case 404: return 'This token no longer exists. Refresh the list and try again.'
    default: return 'Unable to complete the request. Please try again.'
  }
}
