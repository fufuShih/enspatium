import { sql, type Kysely } from 'kysely'
import type { Database } from '../db/index.js'
import type { User } from '../db/types/user.types.js'
import { createAuditEvent } from './audit/audit.js'

export async function requireSiteAdmin(db: Kysely<Database>, actor: string) {
  const user = await db.selectFrom('users').select(['is_admin', 'is_disabled']).where('id', '=', actor).executeTakeFirst()
  if (!user?.is_admin || user.is_disabled) throw Object.assign(new Error('Site administrator access is required.'), { statusCode: 403, code: 'FORBIDDEN' })
}

export function adminUser(user: Pick<User, 'id' | 'email' | 'display_name' | 'is_admin' | 'is_disabled' | 'created_at'>) {
  return { id: user.id, email: user.email, displayName: user.display_name, isAdmin: user.is_admin, isDisabled: user.is_disabled, createdAt: user.created_at.toISOString() }
}

export async function listAdminUsers(db: Kysely<Database>, actor: string, search = '', cursor?: string) {
  await requireSiteAdmin(db, actor)
  let query = db.selectFrom('users').select(['id', 'email', 'display_name', 'is_admin', 'is_disabled', 'created_at']).orderBy('id').limit(31)
  if (cursor) query = query.where('id', '>', cursor)
  if (search.trim()) {
    const escaped = search.trim().replace(/[\\%_]/g, '\\$&')
    query = query.where(eb => eb.or([eb('email', 'ilike', `%${escaped}%`), eb('display_name', 'ilike', `%${escaped}%`)]))
  }
  const rows = await query.execute()
  return { users: rows.slice(0, 30).map(adminUser), nextCursor: rows.length > 30 ? rows[29]!.id : null }
}

export async function setUserDisabled(db: Kysely<Database>, actor: string, id: string, disabled: boolean) {
  return db.transaction().execute(async tx => {
    // Serialize site access changes and recheck the acting admin under the lock.
    await sql`SELECT pg_advisory_xact_lock(173529, 1)`.execute(tx)
    await requireSiteAdmin(tx, actor)
    if (actor === id) throw Object.assign(new Error('You cannot disable your own account.'), { statusCode: 409, code: 'SELF_DISABLE' })
    const user = await tx.selectFrom('users').selectAll().where('id', '=', id).forUpdate().executeTakeFirst()
    if (!user) throw Object.assign(new Error('User not found.'), { statusCode: 404, code: 'NOT_FOUND' })
    if (user.is_disabled === disabled) return adminUser(user)
    const updated = await tx.updateTable('users').set({
      is_disabled: disabled, updated_at: new Date(),
      ...(disabled ? { session_version: sql<number>`session_version + 1` } : {}),
    }).where('id', '=', id).returningAll().executeTakeFirstOrThrow()
    if (disabled) await tx.updateTable('personal_access_tokens').set({ revoked_at: new Date() }).where('user_id', '=', id).where('revoked_at', 'is', null).execute()
    await createAuditEvent(tx, { actorUserId: actor, namespaceId: null, spaceId: null, action: disabled ? 'user.disabled' : 'user.enabled', metadata: { userId: id } })
    return adminUser(updated)
  })
}
