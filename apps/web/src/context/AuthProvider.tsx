import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { login, logout } from '../api/generated/auth'
import type { LoginBody } from '../api/generated/api.schemas'
import { AuthContext } from './auth'
import { loadSession, loadUserProfile } from './session'

const sessionKey = ['session'] as const

export default function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient()
  const session = useQuery({
    queryKey: sessionKey,
    queryFn: ({ signal }) => loadSession(signal),
    retry: false,
    staleTime: 30_000,
  })

  async function signIn(credentials: LoginBody) {
    const account = await login(credentials)
    await queryClient.cancelQueries()
    const user = await loadUserProfile(account)
    queryClient.removeQueries({ predicate: query => query.queryKey[0] !== 'session' })
    queryClient.setQueryData(sessionKey, user)
  }

  async function signOut() {
    await logout()
    await queryClient.cancelQueries()
    queryClient.removeQueries({ predicate: query => query.queryKey[0] !== 'session' })
    queryClient.setQueryData(sessionKey, null)
  }

  const user = session.data ?? null
  return (
    <AuthContext.Provider value={{
      user,
      signedIn: user !== null,
      isLoading: session.isPending,
      error: session.isError,
      retry: () => { void session.refetch() },
      signIn,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  )
}
