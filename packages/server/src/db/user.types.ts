import type {
  Generated,
  Insertable,
  Selectable,
  Updateable,
} from 'kysely'

export interface UserTable {
  id: Generated<string>
  email: string
  password_hash: string
  display_name: string
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export type User = Selectable<UserTable>
export type NewUser = Insertable<UserTable>
export type UserUpdate = Updateable<UserTable>

export interface PublicUser {
  id: string
  email: string
  displayName: string
  createdAt: string
  updatedAt: string
}

export interface CreateUserInput {
  email: string
  password: string
  displayName: string
}

export type UserServiceErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_CREDENTIALS'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'INTERNAL'
