import { createHash } from 'node:crypto'
import type { Kysely } from 'kysely'
import type { Database } from '../db/index.js'
import type { UpdateAppPwaInput } from '../db/types/app.types.js'
import type { PublicPwaEntry } from '../apps/pwa-document.js'
import { getObjectAppPlugin } from '../apps/registry.js'
import { createAuditEvent } from './audit/audit.js'
import { validateAppInstanceName } from './app-instance-config.js'
import { requireSpaceOwnerAccess, SpaceServiceError } from './space/space.js'
import { openObjectDownload } from './object/object.js'
import { builtinPwaIcon, maxPwaIconBytes, sanitizePwaIcon } from './pwa-icons.js'

export async function updateAppPwa(db: Kysely<Database>, dataRoot: string, actorUserId: string, account: string, slug: string, appId: string, input: UpdateAppPwaInput) {
  return db.transaction().execute(async transaction => {
    const access = await requireSpaceOwnerAccess(transaction, actorUserId, account, slug)
    await transaction.selectFrom('spaces').select('id').where('id', '=', access.spaceId).forUpdate().executeTakeFirstOrThrow()
    const instance = await transaction.selectFrom('space_apps').selectAll().where('space_id', '=', access.spaceId).where('id', '=', appId).forUpdate().executeTakeFirst()
    if (!instance) throw new SpaceServiceError('NOT_FOUND', 404, 'App not found.')
    if (!getObjectAppPlugin(instance.app_type) && input.pwa.enabled) throw new SpaceServiceError('INVALID_INPUT', 400, 'This App has no deployed PWA view.')
    if (input.pwa.enabled && input.publishAcknowledged !== true) throw new SpaceServiceError('INVALID_INPUT', 400, 'Acknowledge that installation metadata will be public.')
    const { enabled, iconObjectId, themeColor, offlinePolicy } = input.pwa
    if (typeof enabled !== 'boolean' || offlinePolicy !== 'shell' || (themeColor !== null && !/^#[0-9a-fA-F]{6}$/.test(themeColor))) {
      throw new SpaceServiceError('INVALID_INPUT', 400, 'Invalid PWA settings.')
    }
    let small = instance.pwa_icon_192
    let large = instance.pwa_icon_512
    if (iconObjectId === null) { small = null; large = null }
    else if (input.refreshIcon || iconObjectId !== instance.pwa.iconObjectId || !small || !large) {
      const source = await transaction.selectFrom('space_objects').selectAll().where('space_id', '=', access.spaceId)
        .where('id', '=', iconObjectId).where('is_deleted', '=', false).executeTakeFirst()
      if (!source) throw new SpaceServiceError('INVALID_INPUT', 400, 'Choose an active image from this Space.')
      if (Number(source.size_bytes) > maxPwaIconBytes) throw new SpaceServiceError('INVALID_INPUT', 400, 'The icon must be at most 2 MiB.')
      const content = await openObjectDownload(transaction, dataRoot, actorUserId, account, slug, source.key, source.current_version_id)
      let bytes: Buffer
      try { bytes = await content.file.readFile() } finally { await content.file.close() }
      if (createHash('sha256').update(bytes).digest('hex') !== content.object.checksumSha256) throw new SpaceServiceError('INVALID_INPUT', 400, 'The icon file failed its integrity check.')
      const icons = await sanitizePwaIcon(bytes)
      small = icons.small; large = icons.large
    }
    const updated = await transaction.updateTable('space_apps').set({ name: validateAppInstanceName(input.name),
      pwa: { enabled, iconObjectId, themeColor: themeColor?.toLowerCase() ?? null, offlinePolicy }, pwa_icon_192: small, pwa_icon_512: large,
    }).where('id', '=', instance.id).returningAll().executeTakeFirstOrThrow()
    await createAuditEvent(transaction, { actorUserId, namespaceId: access.namespaceId, spaceId: access.spaceId, action: 'app.updated',
      metadata: { appId, appType: instance.app_type, name: updated.name, fields: ['name', 'pwa'], pwaEnabled: enabled } })
    return updated
  })
}

async function findPublicApp(db: Kysely<Database>, appType: string, appId: string) {
  if (!getObjectAppPlugin(appType)) throw new SpaceServiceError('NOT_FOUND', 404, 'App not found.')
  const instance = await db.selectFrom('space_apps').select(['id', 'app_type', 'name', 'pwa', 'updated_at'])
    .where('id', '=', appId).where('app_type', '=', appType).executeTakeFirst()
  if (!instance) throw new SpaceServiceError('NOT_FOUND', 404, 'App not found.')
  return instance
}

export async function getPublicPwaEntry(db: Kysely<Database>, appType: string, appId: string): Promise<PublicPwaEntry> {
  const instance = await findPublicApp(db, appType, appId)
  return { id: instance.id, appType: instance.app_type, enabled: instance.pwa.enabled,
    ...(instance.pwa.enabled ? { name: instance.name, themeColor: instance.pwa.themeColor, version: instance.updated_at.getTime().toString(36) } : {}) }
}

export async function getPublicPwaIcon(db: Kysely<Database>, appType: string, appId: string, size: 192 | 512) {
  if (!getObjectAppPlugin(appType)) throw new SpaceServiceError('NOT_FOUND', 404, 'App not found.')
  const instance = await db.selectFrom('space_apps').select(['pwa', size === 192 ? 'pwa_icon_192' : 'pwa_icon_512'])
    .where('id', '=', appId).where('app_type', '=', appType).executeTakeFirst()
  if (!instance?.pwa.enabled) throw new SpaceServiceError('NOT_FOUND', 404, 'PWA is not enabled.')
  return instance[size === 192 ? 'pwa_icon_192' : 'pwa_icon_512'] ?? builtinPwaIcon(appType, size)
}
