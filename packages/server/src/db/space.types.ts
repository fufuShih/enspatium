import type {
  Generated,
  Insertable,
  Selectable,
  Updateable,
} from 'kysely'

export type SpaceType = 'git' | 'object'
export type SpaceVisibility = 'public' | 'private'
export type SpaceMemberRole = 'owner' | 'writer' | 'reader'
export type AssignableSpaceMemberRole = Exclude<SpaceMemberRole, 'owner'>

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

export interface SpaceMemberTable {
  space_id: string
  user_id: string
  role: SpaceMemberRole
  created_at: Generated<Date>
}

export type SpaceMember = Selectable<SpaceMemberTable>

export interface CreateSpaceInput {
  name: string
  slug: string
  type: SpaceType
  visibility?: SpaceVisibility
}

export interface UpdateSpaceInput {
  name?: string
  visibility?: SpaceVisibility
}

export interface AddSpaceMemberInput {
  email: string
  role: AssignableSpaceMemberRole
}

export interface UpdateSpaceMemberInput {
  role: AssignableSpaceMemberRole
}

export interface PublicSpaceMember {
  userId: string
  email: string
  displayName: string
  role: SpaceMemberRole
  joinedAt: string
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
  | 'UNAUTHENTICATED'
  | 'CONFLICT'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INTERNAL'
