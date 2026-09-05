import { createContext, useContext } from 'react'
import type { Namespace } from '../pages/UserPage/namespaces'

export type MockUser = { name: string; email: string; namespace: Namespace }

export const MockAuthContext = createContext<{
  user: MockUser | null
  signedIn: boolean
  signIn: (email: string) => void
  signOut: () => void
} | null>(null)

export function useMockAuth() {
  const auth = useContext(MockAuthContext)
  if (!auth) throw new Error('useMockAuth must be used within MockAuthProvider')
  return auth
}
