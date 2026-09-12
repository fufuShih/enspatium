import type { Kysely } from 'kysely'
import type { Database } from '../db/index.js'
import type { AppType } from '../db/app.types.js'
import { getSpaceBySlug, SpaceServiceError } from './space/space.js'

function publicApp(app: AppType) {
  return { type: app.type, name: app.name, kind: app.kind, ownerUserId: app.owner_user_id, storageType: app.storage_type }
}

export async function listApps(db: Kysely<Database>, userId: string | undefined) {
  let query = db.selectFrom('app_types').selectAll()
  query = query.where(eb => eb.or([
    eb('kind', '=', 'builtin'),
    ...(userId ? [eb('owner_user_id', '=', userId)] : []),
  ]))
  return (await query.orderBy('name').orderBy('type').execute()).map(publicApp)
}

export async function getAppSpace(db: Kysely<Database>, userId: string | undefined, appType: string, spaceId: string) {
  const reference = await db.selectFrom('spaces')
    .innerJoin('namespaces', 'namespaces.id', 'spaces.namespace_id')
    .select(['namespaces.slug as account', 'spaces.slug'])
    .where('spaces.id', '=', spaceId).where('spaces.app_type', '=', appType).executeTakeFirst()
  if (!reference) throw new SpaceServiceError('NOT_FOUND', 404, 'App Space was not found.')
  const space = await getSpaceBySlug(db, userId, reference.account, reference.slug)
  if (space.id !== spaceId || space.app !== appType) throw new SpaceServiceError('NOT_FOUND', 404, 'App Space was not found.')
  const app = await db.selectFrom('app_types').selectAll().where('type', '=', appType).executeTakeFirstOrThrow()
  return { id: space.id, name: space.name, slug: space.slug, account: reference.account, app: publicApp(app) }
}
