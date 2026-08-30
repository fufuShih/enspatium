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

export interface Database {
  users: UserTable
}

export type User = Selectable<UserTable>
export type NewUser = Insertable<UserTable>
export type UserUpdate = Updateable<UserTable>