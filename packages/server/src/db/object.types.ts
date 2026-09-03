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
}

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
}

export interface ObjectStorageUsage {
  usedBytes: number
  quotaBytes: number
  remainingBytes: number
}
