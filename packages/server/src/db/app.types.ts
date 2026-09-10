import type { Generated, Selectable } from 'kysely'
import type { SpaceType } from './space.types.js'

export interface AppTable {
  type: string
  name: string
  kind: 'builtin' | 'custom'
  owner_user_id: string | null
  storage_type: SpaceType
  created_at: Generated<Date>
}

export type App = Selectable<AppTable>
