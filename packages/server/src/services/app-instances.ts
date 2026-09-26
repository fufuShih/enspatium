import type { Kysely } from 'kysely'
import type { Database } from '../db/index.js'
import type { CreateAppInstanceInput, SpaceApp, UpdateAppInstanceInput } from '../db/types/app.types.js'
import { validateAppInstanceConfig, validateAppInstanceName } from './app-instance-config.js'
import { getSpaceBySlug, getSpaceDetails, requireSpaceOwnerAccess, SpaceServiceError } from './space/space.js'
import { createAuditEvent } from './audit/audit.js'

const instanceColumns = ['id', 'space_id', 'app_type', 'storage_type', 'name', 'config', 'pwa', 'created_at', 'updated_at'] as const

// Every read derives its permissions from the owning Space. Mutations and their
// audit events commit together, without touching shared content or permissions.
export async function listAppInstances(db: Kysely<Database>, actorUserId: string | undefined, account: string, spaceSlug: string) {
  const space = await getSpaceBySlug(db, actorUserId, account, spaceSlug)
  return findSpaceApps(db, space.id)
}

function findSpaceApps(db: Kysely<Database>, spaceId: string) {
  return db.selectFrom('space_apps').select(instanceColumns).where('space_id', '=', spaceId)
    .orderBy('created_at', 'asc').orderBy('id', 'asc').execute()
}

export async function listSpaceApps(db: Kysely<Database>, actorUserId: string | undefined, account: string, spaceSlug: string) {
  const space = await getSpaceDetails(db, actorUserId, account, spaceSlug)
  return { apps: (await findSpaceApps(db, space.id)).map(toAppInstanceSummary), canManage: space.canManage }
}

export function toAppInstanceSummary(instance: Pick<SpaceApp, typeof instanceColumns[number]>) {
  return { id: instance.id, spaceId: instance.space_id, appType: instance.app_type, name: instance.name,
    config: instance.config, pwa: instance.pwa, createdAt: instance.created_at.toISOString(), updatedAt: instance.updated_at.toISOString() }
}

export async function getAppInstance(db: Kysely<Database>, actorUserId: string | undefined, appType: string, appId: string) {
  const instance = await db.selectFrom('space_apps')
    .innerJoin('spaces', 'spaces.id', 'space_apps.space_id')
    .innerJoin('namespaces', 'namespaces.id', 'spaces.namespace_id')
    .select(instanceColumns.map(column => `space_apps.${column}` as const)).select(['namespaces.slug as account', 'spaces.slug as spaceSlug'])
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
    const instance = await transaction.insertInto('space_apps').values({
      space_id: access.spaceId,
      storage_type: space.type,
      app_type: app.type,
      name: validateAppInstanceName(input.name ?? space.name),
      config: validateAppInstanceConfig(app.type, input.config === undefined ? {} : input.config),
    }).returningAll().executeTakeFirstOrThrow()
    await createAuditEvent(transaction, { actorUserId, namespaceId: access.namespaceId, spaceId: access.spaceId,
      action: 'app.created', metadata: { appId: instance.id, appType: instance.app_type, name: instance.name } })
    return instance
  })
}

export async function updateAppInstance(db: Kysely<Database>, actorUserId: string, account: string, spaceSlug: string, appId: string, input: UpdateAppInstanceInput) {
  return db.transaction().execute(async transaction => {
    const access = await requireSpaceOwnerAccess(transaction, actorUserId, account, spaceSlug)
    await transaction.selectFrom('spaces').select('id').where('id', '=', access.spaceId).forUpdate().executeTakeFirstOrThrow()
    const instance = await transaction.selectFrom('space_apps').selectAll()
      .where('space_id', '=', access.spaceId).where('id', '=', appId).forUpdate().executeTakeFirst()
    if (!instance) throw new SpaceServiceError('NOT_FOUND', 404, 'App instance not found.')
    const updated = await transaction.updateTable('space_apps').set({
      name: input.name === undefined ? instance.name : validateAppInstanceName(input.name),
      config: input.config === undefined ? instance.config : validateAppInstanceConfig(instance.app_type, input.config),
    }).where('id', '=', instance.id).returningAll().executeTakeFirstOrThrow()
    await createAuditEvent(transaction, { actorUserId, namespaceId: access.namespaceId, spaceId: access.spaceId,
      action: 'app.updated', metadata: { appId: instance.id, appType: instance.app_type, name: updated.name, fields: Object.keys(input) } })
    return updated
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
    await createAuditEvent(transaction, { actorUserId, namespaceId: access.namespaceId, spaceId: access.spaceId,
      action: 'app.deleted', metadata: { appId: instance.id, appType: instance.app_type, name: instance.name } })
  })
}
