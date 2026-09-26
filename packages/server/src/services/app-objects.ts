import { sql, type Kysely } from 'kysely'
import type { Database } from '../db/index.js'
import type { SpaceObject } from '../db/types/object.types.js'
import { getObjectAppPlugin } from '../apps/registry.js'
import type { ObjectAppKind, ObjectAppPlugin } from '../apps/types.js'
import { getSpaceBySlug, getWritableObjectSpace, SpaceServiceError } from './space/space.js'
import { requireSpaceStorage } from './space/storage.js'
import { escapeLikePrefix, ObjectServiceError, openObjectDownload, toPublicSpaceObject } from './object/object.js'
import { getAppInstance } from './app-instances.js'

type AppObjectSource = { appType: string } & ({ appId: string } | { account: string; slug: string })

async function requireAppSpace(db: Kysely<Database>, userId: string | undefined, source: AppObjectSource) {
  const { appType } = source
  // Legacy content endpoints only resolve the original instance, never another
  // instance of the same type. Instance endpoints derive Space solely on server.
  let instance
  if ('appId' in source) {
    instance = await getAppInstance(db, userId, appType, source.appId)
  } else {
    const space = await getSpaceBySlug(db, userId, source.account, source.slug)
    if (space.app !== appType) throw new ObjectServiceError('NOT_FOUND', 404, 'App is not available for this Space.')
    instance = await getAppInstance(db, userId, appType, space.id)
    if (instance.space_id !== space.id) throw new ObjectServiceError('NOT_FOUND', 404, 'App is not available for this Space.')
  }
  const plugin = getObjectAppPlugin(appType)
  if (!plugin || instance.storage_type !== plugin.storageType) {
    throw new ObjectServiceError('NOT_FOUND', 404, 'App is not available for this Space.')
  }
  return { spaceId: instance.space_id, plugin, account: instance.account, slug: instance.spaceSlug }
}

export function classifyAppObject(plugin: ObjectAppPlugin, key: string, contentType: string) {
  const mime = contentType.split(';', 1)[0]!.trim().toLowerCase()
  const extension = key.split('.').at(-1)?.toLowerCase()
  return plugin.kinds.find(rule => rule.contentTypes.some(type => type.endsWith('/*') ? mime.startsWith(type.slice(0, -1)) : mime === type)
    || ((rule.extensionContentTypes ?? ['application/octet-stream']).includes(mime) && key.includes('.') && rule.extensions?.includes(extension!)))
}

function kindCondition(rule: ObjectAppKind) {
  const mime = sql`lower(trim(split_part(content_type, ';', 1)))`
  const conditions = rule.contentTypes.map(type => type.endsWith('/*')
    ? sql`${mime} like ${escapeLikePrefix(type.slice(0, -1)) + '%'}` : sql`${mime} = ${type}`)
  if (rule.extensions?.length && (rule.extensionContentTypes ?? ['application/octet-stream']).length) conditions.push(sql`${mime} in (${sql.join(rule.extensionContentTypes ?? ['application/octet-stream'])})
    and strpos(key, '.') > 0 and lower(substring(key from '[^.]+$')) in (${sql.join(rule.extensions)})`)
  return conditions.length ? sql`(${sql.join(conditions, sql` or `)})` : sql`false`
}

export async function listAppObjects(
  db: Kysely<Database>, dataRoot: string, userId: string | undefined, source: AppObjectSource,
  input: { kind?: string; search?: string; cursor?: string; limit?: number },
) {
  const { spaceId, plugin, account, slug } = await requireAppSpace(db, userId, source)
  if (input.kind && !plugin.kinds.some(rule => rule.kind === input.kind)) {
    throw new ObjectServiceError('INVALID_INPUT', 400, 'This kind is not supported by this app.')
  }
  await requireSpaceStorage(dataRoot, spaceId, 'object')
  let canUpload = false
  if (userId) {
    try { await getWritableObjectSpace(db, userId, account, slug); canUpload = true } catch (error) {
      if (!(error instanceof SpaceServiceError) || error.statusCode !== 403) throw error
    }
  }
  const limit = input.limit ?? 30
  const kind = plugin.kinds.length ? sql`case ${sql.join(plugin.kinds.map(rule => sql`when ${kindCondition(rule)} then ${rule.kind}`), sql` `)} end` : sql`null::text`
  // Classify/filter the complete set before pagination; every app uses the same query.
  const result = await sql<SpaceObject & { kind: string }>`
    with items as (
      select objects.*, ${kind} as kind from space_objects objects
      where space_id = ${spaceId} and not is_deleted
    )
    select * from items where kind is not null
      ${input.kind ? sql`and kind = ${input.kind}` : sql``}
      ${input.search ? sql`and regexp_replace(key, '^.*/', '') ilike ${'%' + escapeLikePrefix(input.search) + '%'}` : sql``}
      ${input.cursor ? sql`and key collate "C" > ${input.cursor} collate "C"` : sql``}
    order by key collate "C" limit ${limit + 1}
  `.execute(db)
  const page = result.rows.slice(0, limit)
  return { canUpload, objects: page.map(row => ({ ...toPublicSpaceObject(row), kind: row.kind })),
    nextCursor: result.rows.length > limit ? page.at(-1)!.key : null }
}

export async function getAppObject(
  db: Kysely<Database>, dataRoot: string, userId: string | undefined, source: AppObjectSource, itemId: string,
) {
  const { spaceId, plugin } = await requireAppSpace(db, userId, source)
  await requireSpaceStorage(dataRoot, spaceId, 'object')
  const item = await db.selectFrom('space_objects').selectAll()
    .where('space_id', '=', spaceId).where('id', '=', itemId).where('is_deleted', '=', false).executeTakeFirst()
  const rule = item && classifyAppObject(plugin, item.key, item.content_type)
  if (!item || !rule) throw new ObjectServiceError('NOT_FOUND', 404, 'App item was not found.')
  return { ...toPublicSpaceObject(item), kind: rule.kind }
}

export async function openAppContent(
  db: Kysely<Database>, dataRoot: string, userId: string | undefined, source: AppObjectSource,
  key: string, versionId: string,
) {
  const { plugin, account, slug } = await requireAppSpace(db, userId, source)
  const content = await openObjectDownload(db, dataRoot, userId, account, slug, key, versionId)
  const rule = classifyAppObject(plugin, content.object.key, content.object.contentType)
  if (!rule) {
    await content.file.close()
    throw new ObjectServiceError('NOT_FOUND', 404, 'App item was not found.')
  }
  content.object.contentType = rule.contentType ?? content.object.contentType
  return content
}
