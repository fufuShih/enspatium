import type {
  Generated,
  Insertable,
  JSONColumnType,
  Selectable,
} from 'kysely'

export const auditActions = [
  'space.created',
  'space.updated',
  'space.deleted',
  'git.pushed',
] as const

export type AuditAction = (typeof auditActions)[number]
export type AuditMetadata = Record<string, unknown>

export interface AuditEventTable {
  id: Generated<string>
  actor_user_id: string | null
  namespace_id: string | null
  space_id: string | null
  action: AuditAction
  metadata: JSONColumnType<AuditMetadata, AuditMetadata, AuditMetadata>
  created_at: Generated<Date>
}

export type AuditEvent = Selectable<AuditEventTable>
export type NewAuditEvent = Insertable<AuditEventTable>

export interface CreateAuditEventInput {
  actorUserId: string | null
  namespaceId: string | null
  spaceId: string | null
  action: AuditAction
  metadata?: AuditMetadata
}

export interface PublicAuditEvent {
  id: string
  actorUserId: string | null
  namespaceId: string | null
  spaceId: string | null
  action: AuditAction
  metadata: AuditMetadata
  createdAt: string
}
