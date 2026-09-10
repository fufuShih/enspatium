import { sql, type Kysely } from 'kysely'
import type { Database } from '../../db/index.js'
import type { SpaceObject } from '../../db/object.types.js'
import { getReadableObjectSpace, getWritableObjectSpace, SpaceServiceError } from '../space/space.js'
import { requireSpaceStorage } from '../space/storage.js'
import { escapeLikePrefix, ObjectServiceError, toPublicSpaceObject } from './object.js'

export async function requireMediaSpace(db: Kysely<Database>, userId: string | undefined, account: string, slug: string) {
  const space = await getReadableObjectSpace(db, userId, account, slug)
  if (space.app !== 'media') throw new ObjectServiceError('NOT_FOUND', 404, 'Media Space was not found.')
  return space
}

export async function listMedia(
  db: Kysely<Database>, dataRoot: string, userId: string | undefined, account: string, slug: string,
  input: { kind?: 'audio' | 'video' | 'image'; search?: string; cursor?: string; limit?: number },
) {
  const space = await requireMediaSpace(db, userId, account, slug)
  await requireSpaceStorage(dataRoot, space.id, 'object')
  let canUpload = false
  if (userId) {
    try { await getWritableObjectSpace(db, userId, account, slug); canUpload = true } catch (error) {
      if (!(error instanceof SpaceServiceError) || error.statusCode !== 403) throw error
    }
  }
  const limit = input.limit ?? 30
  // Filter the entire set before pagination. SVG/HTML are never embedded media.
  const result = await sql<SpaceObject & { kind: 'audio' | 'video' | 'image' }>`
    with media as (
      select objects.*, case
        when lower(split_part(content_type, ';', 1)) like 'audio/%' then 'audio'
        when lower(split_part(content_type, ';', 1)) like 'video/%' then 'video'
        when lower(split_part(content_type, ';', 1)) in ('image/jpeg','image/png','image/webp','image/gif','image/avif','image/bmp') then 'image'
      end as kind
      from space_objects objects
      where space_id = ${space.id} and not is_deleted
    )
    select * from media where kind is not null
      ${input.kind ? sql`and kind = ${input.kind}` : sql``}
      ${input.search ? sql`and regexp_replace(key, '^.*/', '') ilike ${'%' + escapeLikePrefix(input.search) + '%'}` : sql``}
      ${input.cursor ? sql`and key collate "C" > ${input.cursor} collate "C"` : sql``}
    order by key collate "C" limit ${limit + 1}
  `.execute(db)
  const page = result.rows.slice(0, limit)
  return {
    canUpload,
    objects: page.map(row => ({ ...toPublicSpaceObject(row), kind: row.kind })),
    nextCursor: result.rows.length > limit ? page.at(-1)!.key : null,
  }
}
