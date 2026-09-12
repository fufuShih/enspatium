import type { Generated, Insertable, Selectable } from 'kysely'

export interface SpaceObjectTable {
  id: Generated<string>
  space_id: string
  created_by_user_id: string | null
  key: string
  content_type: string
  size_bytes: number
  checksum_sha256: string
  created_at: Generated<Date>
  updated_at: Generated<Date>
  current_version_id: Generated<string>
  revision: Generated<number>
  is_deleted: Generated<boolean>
}

export interface SpaceObjectVersionTable {
  id: string
  object_id: string
  space_id: string
  revision: number
  storage_key: string | null
  is_deleted: boolean
  content_type: string
  size_bytes: number
  checksum_sha256: string
  created_by_user_id: string | null
  created_at: Generated<Date>
  inactive_at: Generated<Date | null>
  purge_started_at: Generated<Date | null>
}

export type SpaceObjectVersion = Selectable<SpaceObjectVersionTable>

export type SpaceObject = Selectable<SpaceObjectTable>
export type NewSpaceObject = Insertable<SpaceObjectTable>

export interface PublicSpaceObject {
  id: string
  spaceId: string
  createdByUserId: string | null
  key: string
  contentType: string
  sizeBytes: number
  checksumSha256: string
  createdAt: string
  updatedAt: string
  versionId: string
  revision: number
  isDeleted: boolean
}

export interface PublicObjectVersion extends PublicSpaceObject {
  createdByName: string | null
}

export interface ObjectVersionPage {
  versionLimit: number
  retentionDays: number
  object: PublicSpaceObject
  versions: PublicObjectVersion[]
  nextCursor: number | null
}

export interface ObjectStorageUsage {
  usedBytes: number
  quotaBytes: number
  remainingBytes: number
}

export interface MoveObjectInput {
  objectId: string
  key: string
  newKey: string
  expectedVersion: string
}
