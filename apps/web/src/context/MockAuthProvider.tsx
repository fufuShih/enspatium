import { useState } from 'react'
import type { PropsWithChildren } from 'react'
import { MockAuthContext } from './mockAuth'
import type { MockUser } from './mockAuth'
import { accountFromEmail } from '../pages/UserPage/namespaces'

export default function MockAuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<MockUser | null>(null)

  function signIn(email: string) {
    const address = email.trim()
    const name = address.split('@')[0] || 'Demo User'
    setUser({ name, email: address, namespace: { kind: 'user', account: accountFromEmail(address), name, bio: 'Code, notes, and personal projects.' } })
  }

  return (
    <MockAuthContext.Provider value={{ user, signedIn: user !== null, signIn, signOut: () => setUser(null) }}>
      {children}
    </MockAuthContext.Provider>
  )
}
