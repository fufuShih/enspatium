import type {
  Generated,
  Insertable,
  Selectable,
  Updateable,
} from 'kysely'

export type SpaceType = 'git' | 'object'
export type SpaceVisibility = 'public' | 'private'

export interface SpaceTable {
  id: Generated<string>
  namespace_id: string
  created_by_user_id: string | null
  name: string
  slug: string
  type: SpaceType
  visibility: Generated<SpaceVisibility>
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export type Space = Selectable<SpaceTable>
export type NewSpace = Insertable<SpaceTable>
export type SpaceUpdate = Updateable<SpaceTable>

export interface CreateSpaceInput {
  name: string
  slug: string
  type: SpaceType
  visibility?: SpaceVisibility
}

export interface PublicSpace {
  id: string
  namespaceId: string
  createdByUserId: string | null
  name: string
  slug: string
  type: SpaceType
  visibility: SpaceVisibility
  createdAt: string
  updatedAt: string
}

export type SpaceServiceErrorCode =
  | 'INVALID_INPUT'
  | 'CONFLICT'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INTERNAL'