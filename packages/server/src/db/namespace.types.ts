import type {
  Generated,
  Insertable,
  Selectable,
  Updateable,
} from 'kysely'

export type NamespaceKind = 'personal' | 'organization'

export interface NamespaceTable {
  id: Generated<string>
  owner_user_id: string
  name: string
  slug: string
  kind: NamespaceKind
  created_at: Generated<Date>
}

export type Namespace = Selectable<NamespaceTable>
export type NewNamespace = Insertable<NamespaceTable>
export type NamespaceUpdate = Updateable<NamespaceTable>

export interface PublicNamespace {
  id: string
  ownerUserId: string
  name: string
  slug: string
  kind: NamespaceKind
  createdAt: string
}

export interface CreateOrganizationNamespaceInput {
  name: string
  slug: string
}

export type NamespaceMemberRole = 'owner' | 'member'

export interface NamespaceMemberTable {
  namespace_id: string
  user_id: string
  role: NamespaceMemberRole
  created_at: Generated<Date>
}

export type NamespaceMember = Selectable<NamespaceMemberTable>

export interface AddNamespaceMemberInput {
  email: string
}

export interface PublicNamespaceMember {
  userId: string
  email: string
  displayName: string
  role: NamespaceMemberRole
  joinedAt: string
}

export type NamespaceServiceErrorCode =
  | 'INVALID_INPUT'
  | 'CONFLICT'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INTERNAL'
