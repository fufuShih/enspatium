import type { Kysely, Transaction } from 'kysely'

import type { Database } from '../db/index.js'
import type {
  Namespace,
  NamespaceServiceErrorCode,
  PublicNamespace,
} from '../db/namespace.types.js'

export class NamespaceServiceError extends Error {
  constructor(
    readonly code: NamespaceServiceErrorCode,
    readonly statusCode: number,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause })
    this.name = 'NamespaceServiceError'
  }
}

export async function createPersonalNamespace(
  transaction: Transaction<Database>,
  ownerUserId: string,
  displayName: string,
): Promise<PublicNamespace> {
  try {
    const namespace = await transaction
      .insertInto('namespaces')
      .values({
        owner_user_id: ownerUserId,
        name: displayName.trim(),
        slug: personalNamespaceSlug(ownerUserId),
        kind: 'personal',
      })
      .returningAll()
      .executeTakeFirstOrThrow()

    return toPublicNamespace(namespace)
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new NamespaceServiceError(
        'CONFLICT',
        409,
        'personal namespace already exists',
      )
    }

    throw new NamespaceServiceError(
      'INTERNAL',
      500,
      'failed to create personal namespace',
      error,
    )
  }
}

export async function listNamespaces(
  db: Kysely<Database>,
  ownerUserId: string,
): Promise<PublicNamespace[]> {
  try {
    const namespaces = await db
      .selectFrom('namespaces')
      .selectAll()
      .where('owner_user_id', '=', ownerUserId)
      .orderBy('created_at', 'asc')
      .execute()

    return namespaces.map(toPublicNamespace)
  } catch (error) {
    throw new NamespaceServiceError(
      'INTERNAL',
      500,
      'failed to list namespaces',
      error,
    )
  }
}

export function personalNamespaceSlug(userId: string): string {
  return `u-${userId.replaceAll('-', '')}`
}

function toPublicNamespace(namespace: Namespace): PublicNamespace {
  return {
    id: namespace.id,
    ownerUserId: namespace.owner_user_id,
    name: namespace.name,
    slug: namespace.slug,
    kind: namespace.kind,
    createdAt: namespace.created_at.toISOString(),
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  )
}
