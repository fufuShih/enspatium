import type { Kysely } from 'kysely'
import type { Database } from '../db/index.js'
import type { CreateAppInstanceInput, UpdateAppInstanceInput } from '../db/types/app.types.js'
import { validateAppInstanceConfig, validateAppInstanceName } from './app-instance-config.js'
import { getSpaceBySlug, requireSpaceOwnerAccess, SpaceServiceError } from './space/space.js'

// Internal data-layer operations. HTTP schemas and instance-based routes follow
// separately; every read still derives its permissions from the owning Space.
export async function listAppInstances(db: Kysely<Database>, actorUserId: string | undefined, account: string, spaceSlug: string) {
  const space = await getSpaceBySlug(db, actorUserId, account, spaceSlug)
  return db.selectFrom('space_apps').selectAll().where('space_id', '=', space.id)
    .orderBy('created_at', 'asc').orderBy('id', 'asc').execute()
}

export async function getAppInstance(db: Kysely<Database>, actorUserId: string | undefined, appType: string, appId: string) {
  const instance = await db.selectFrom('space_apps')
    .innerJoin('spaces', 'spaces.id', 'space_apps.space_id')
    .innerJoin('namespaces', 'namespaces.id', 'spaces.namespace_id')
    .selectAll('space_apps').select(['namespaces.slug as account', 'spaces.slug as spaceSlug'])
    .where('space_apps.id', '=', appId).where('space_apps.app_type', '=', appType).executeTakeFirst()
  if (!instance) throw new SpaceServiceError('NOT_FOUND', 404, 'App instance not found.')
  const space = await getSpaceBySlug(db, actorUserId, instance.account, instance.spaceSlug)
  if (space.id !== instance.space_id) throw new SpaceServiceError('NOT_FOUND', 404, 'App instance not found.')
  return instance
}

export async function createAppInstance(db: Kysely<Database>, actorUserId: string, account: string, spaceSlug: string, input: CreateAppInstanceInput) {
  return db.transaction().execute(async transaction => {
    const access = await requireSpaceOwnerAccess(transaction, actorUserId, account, spaceSlug)
    const space = await transaction.selectFrom('spaces').select(['name', 'type'])
      .where('id', '=', access.spaceId).forUpdate().executeTakeFirstOrThrow()
    const app = await transaction.selectFrom('app_types').selectAll().where('type', '=', input.appType).executeTakeFirst()
    if (!app) throw new SpaceServiceError('INVALID_INPUT', 400, 'App type is not registered.')
    if (app.storage_type !== space.type) throw new SpaceServiceError('INVALID_INPUT', 400, 'App does not support this storage type.')
    if (app.kind === 'custom' && app.owner_user_id !== actorUserId) {
      throw new SpaceServiceError('FORBIDDEN', 403, 'Only the creator can create instances of this custom app.')
    }
    return transaction.insertInto('space_apps').values({
      space_id: access.spaceId,
      storage_type: space.type,
      app_type: app.type,
      name: validateAppInstanceName(input.name ?? space.name),
      config: validateAppInstanceConfig(app.type, input.config === undefined ? {} : input.config),
    }).returningAll().executeTakeFirstOrThrow()
  })
}

export async function updateAppInstance(db: Kysely<Database>, actorUserId: string, account: string, spaceSlug: string, appId: string, input: UpdateAppInstanceInput) {
  return db.transaction().execute(async transaction => {
    const access = await requireSpaceOwnerAccess(transaction, actorUserId, account, spaceSlug)
    const instance = await transaction.selectFrom('space_apps').selectAll()
      .where('space_id', '=', access.spaceId).where('id', '=', appId).forUpdate().executeTakeFirst()
    if (!instance) throw new SpaceServiceError('NOT_FOUND', 404, 'App instance not found.')
    return transaction.updateTable('space_apps').set({
      name: input.name === undefined ? instance.name : validateAppInstanceName(input.name),
      config: input.config === undefined ? instance.config : validateAppInstanceConfig(instance.app_type, input.config),
    }).where('id', '=', instance.id).returningAll().executeTakeFirstOrThrow()
  })
}

export async function deleteAppInstance(db: Kysely<Database>, actorUserId: string, account: string, spaceSlug: string, appId: string) {
  return db.transaction().execute(async transaction => {
    const access = await requireSpaceOwnerAccess(transaction, actorUserId, account, spaceSlug)
    // Lock Space before instance, matching creation and cascading Space deletion.
    await transaction.selectFrom('spaces').select('id').where('id', '=', access.spaceId).forUpdate().executeTakeFirstOrThrow()
    const instance = await transaction.deleteFrom('space_apps')
      .where('space_id', '=', access.spaceId).where('id', '=', appId).returningAll().executeTakeFirst()
    if (!instance) throw new SpaceServiceError('NOT_FOUND', 404, 'App instance not found.')
    if (instance.id === instance.space_id) {
      // Never redirect the old entry to another same-kind instance.
      await transaction.updateTable('spaces').set({ app_type: null })
        .where('id', '=', access.spaceId).where('app_type', '=', instance.app_type).execute()
    }
  })
}
