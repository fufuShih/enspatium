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
