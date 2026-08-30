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

export type NamespaceServiceErrorCode = 'CONFLICT' | 'INTERNAL'
