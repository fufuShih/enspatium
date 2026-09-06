export type Namespace = {
  kind: 'user' | 'org'
  account: string
  name: string
  bio: string
}

export function namespacePath(owner: Pick<Namespace, 'account'>) {
  return `/${encodeURIComponent(owner.account)}`
}
