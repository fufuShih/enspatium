import type { Kysely } from 'kysely'

import type {
  AuditEvent,
  CreateAuditEventInput,
  PublicAuditEvent,
} from '../../db/audit.types.js'
import type { Database } from '../../db/index.js'

export const defaultAuditEventLimit = 50
export const maximumAuditEventLimit = 100

export class AuditServiceError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause })
    this.name = 'AuditServiceError'
  }
}

export async function createAuditEvent(
  db: Kysely<Database>,
  input: CreateAuditEventInput,
): Promise<PublicAuditEvent> {
  try {
    const event = await db
      .insertInto('audit_events')
      .values({
        actor_user_id: input.actorUserId,
        namespace_id: input.namespaceId,
        space_id: input.spaceId,
        action: input.action,
        metadata: input.metadata ?? {},
      })
      .returningAll()
      .executeTakeFirstOrThrow()

    return toPublicAuditEvent(event)
  } catch (error) {
    throw new AuditServiceError(500, 'failed to create audit event', error)
  }
}

export async function listSpaceAuditEvents(
  db: Kysely<Database>,
  spaceId: string,
  inputLimit?: number,
): Promise<PublicAuditEvent[]> {
  const limit = normalizeAuditEventLimit(inputLimit)

  try {
    const events = await db
      .selectFrom('audit_events')
      .selectAll()
      .where('space_id', '=', spaceId)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
      .execute()

    return events.map(toPublicAuditEvent)
  } catch (error) {
    throw new AuditServiceError(500, 'failed to list audit events', error)
  }
}

export function normalizeAuditEventLimit(input?: number): number {
  if (input === undefined) {
    return defaultAuditEventLimit
  }

  if (
    !Number.isInteger(input) ||
    input < 1 ||
    input > maximumAuditEventLimit
  ) {
    throw new AuditServiceError(
      400,
      `limit must be an integer between 1 and ${maximumAuditEventLimit}`,
    )
  }

  return input
}

function toPublicAuditEvent(event: AuditEvent): PublicAuditEvent {
  return {
    id: event.id,
    actorUserId: event.actor_user_id,
    namespaceId: event.namespace_id,
    spaceId: event.space_id,
    action: event.action,
    metadata: event.metadata,
    createdAt: event.created_at.toISOString(),
  }
}
