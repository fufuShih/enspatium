import { getCurrentUser } from '../api/generated/auth.ts'
import { listNamespaces } from '../api/generated/namespaces.ts'
import type { GetCurrentUser200 } from '../api/generated/api.schemas.ts'
import type { Namespace } from '../pages/UserPage/namespaces.ts'

export type AuthUser = GetCurrentUser200 & { name: string; namespace: Namespace }

export function authReturnPath(from: unknown): string | undefined {
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && !/[\\\r\n]/.test(from) && !/^\/(login|register)([/?#]|$)/.test(from) ? from : undefined
}

export function apiStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number') return error.status
}

export function apiCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('info' in error)) return
  const info = error.info
  if (typeof info === 'object' && info !== null && 'code' in info && typeof info.code === 'string') return info.code
}

export function authErrorMessage(error: unknown, action: 'login' | 'register' | 'logout') {
  const status = apiStatus(error)
  if (apiCode(error) === 'REGISTRATION_CLOSED') return 'Registration is closed. Contact the site administrator.'
  if (action === 'login' && status === 401) return 'Incorrect email or password.'
  if (action === 'register' && status === 409) return 'An account with this email already exists. Please sign in.'
  if (status === 400) return 'Please check your details and try again.'
  if (status === 429) return 'Too many attempts. Please try again later.'
  return action === 'logout'
    ? 'Unable to sign out. Please try again.'
    : 'Unable to connect. Please try again.'
}

export async function loadUserProfile(user: GetCurrentUser200, signal?: AbortSignal): Promise<AuthUser> {
  const namespaces = await listNamespaces({ signal })
  const personal = namespaces.find(namespace => namespace.kind === 'personal' && namespace.ownerUserId === user.id)
  if (!personal) throw new Error('Personal namespace not found')
  return {
    ...user,
    name: user.displayName,
    namespace: { kind: 'user', account: personal.slug, name: personal.name, bio: '' },
  }
}

export async function loadSession(signal?: AbortSignal): Promise<AuthUser | null> {
  try {
    return await loadUserProfile(await getCurrentUser({ signal }), signal)
  } catch (error) {
    if (apiStatus(error) === 401) return null
    throw error
  }
}
