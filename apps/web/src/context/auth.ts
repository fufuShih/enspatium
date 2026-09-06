import { createContext, useContext } from 'react'
import type { LoginBody } from '../api/generated/api.schemas'
import type { AuthUser } from './session'

export const AuthContext = createContext<{
  user: AuthUser | null
  signedIn: boolean
  isLoading: boolean
  error: boolean
  retry: () => void
  signIn: (credentials: LoginBody) => Promise<void>
  signOut: () => Promise<void>
} | null>(null)

export function useAuth() {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth must be used within AuthProvider')
  return auth
}
