export type Namespace = {
  kind: 'user' | 'org'
  account: string
  name: string
  bio: string
}

export const demoUser: Namespace = {
  kind: 'user', account: 'demo', name: 'Demo User', bio: 'Code, notes, and personal projects.',
}

export const demoOrganization: Namespace = {
  kind: 'org', account: 'enspatium', name: 'Enspatium', bio: 'A shared home for our projects and design assets.',
}

export const initialNamespaces = [demoUser, demoOrganization]

export function namespacePath(owner: Pick<Namespace, 'account'>) {
  return `/${encodeURIComponent(owner.account)}`
}

export function sameNamespace(left: Namespace, right: Namespace) {
  return left.account === right.account
}

export function accountFromEmail(email: string) {
  const account = email.trim().split('@')[0]?.toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'demo'
  // Accounts share the URL namespace with organizations and application pages.
  const reserved = new Set(['login', 'space', ...initialNamespaces.filter(owner => owner.kind === 'org').map(owner => owner.account)])
  return reserved.has(account) ? `${account}-user` : account
}
