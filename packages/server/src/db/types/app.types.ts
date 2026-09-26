import type { Generated, JSONColumnType, Selectable } from 'kysely'
import type { SpaceType } from './space.types.js'

export interface AppTypeTable {
  type: string
  name: string
  kind: 'builtin' | 'custom'
  owner_user_id: string | null
  storage_type: SpaceType
  created_at: Generated<Date>
}

export type AppType = Selectable<AppTypeTable>

export type AppConfigValue = null | boolean | number | string | AppConfigValue[] | AppConfig
export type AppConfig = { [key: string]: AppConfigValue }

export interface AppPwaSettings {
  enabled: boolean
  iconObjectId: string | null
  // null inherits the platform theme; there is no per-instance offline content cache.
  themeColor: string | null
  offlinePolicy: 'shell'
}

export interface SpaceAppTable {
  id: Generated<string>
  space_id: string
  app_type: string
  storage_type: SpaceType
  name: string
  config: JSONColumnType<AppConfig, AppConfig | undefined, AppConfig>
  pwa: JSONColumnType<AppPwaSettings, AppPwaSettings | undefined, AppPwaSettings>
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export type SpaceApp = Selectable<SpaceAppTable>

export interface CreateAppInstanceInput {
  appType: string
  name?: string
  config?: AppConfig
}

// Identity, storage type and PWA delivery settings are not mutable here.
export interface UpdateAppInstanceInput {
  name?: string
  config?: AppConfig
}
