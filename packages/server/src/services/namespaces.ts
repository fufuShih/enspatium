import type { Kysely, Transaction } from 'kysely'

import type { Database } from '../db/index.js'
import type {
  CreateOrganizationNamespaceInput,
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

export async function createOrganizationNamespace(
  db: Kysely<Database>,
  ownerUserId: string,
  input: CreateOrganizationNamespaceInput,
): Promise<PublicNamespace> {
  const name = input.name.trim()
  const slug = normalizeNamespaceSlug(input.slug)

  validateNamespace(name, slug)

  try {
    const namespace = await db
      .insertInto('namespaces')
      .values({
        owner_user_id: ownerUserId,
        name,
        slug,
        kind: 'organization',
      })
      .returningAll()
      .executeTakeFirstOrThrow()

    return toPublicNamespace(namespace)
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new NamespaceServiceError(
        'CONFLICT',
        409,
        'namespace slug already exists',
      )
    }

    throw new NamespaceServiceError(
      'INTERNAL',
      500,
      'failed to create organization namespace',
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

export async function getNamespaceBySlug(
  db: Kysely<Database>,
  inputSlug: string,
): Promise<PublicNamespace> {
  const slug = normalizeNamespaceSlug(inputSlug)

  validateNamespaceSlug(slug)

  try {
    const namespace = await db
      .selectFrom('namespaces')
      .selectAll()
      .where('slug', '=', slug)
      .executeTakeFirst()

    if (!namespace) {
      throw new NamespaceServiceError(
        'NOT_FOUND',
        404,
        'namespace not found',
      )
    }

    return toPublicNamespace(namespace)
  } catch (error) {
    if (error instanceof NamespaceServiceError) {
      throw error
    }

    throw new NamespaceServiceError(
      'INTERNAL',
      500,
      'failed to get namespace',
      error,
    )
  }
}

export function personalNamespaceSlug(userId: string): string {
  return `u-${userId.replaceAll('-', '')}`
}

export function normalizeNamespaceSlug(slug: string): string {
  return slug.trim().toLowerCase()
}

export function validateNamespace(name: string, slug: string): void {
  if (!name) {
    throw new NamespaceServiceError(
      'INVALID_INPUT',
      400,
      'namespace name is required',
    )
  }

  if (name.length > 100) {
    throw new NamespaceServiceError(
      'INVALID_INPUT',
      400,
      'namespace name must contain at most 100 characters',
    )
  }

  validateNamespaceSlug(slug)
}

export function validateNamespaceSlug(slug: string): void {
  if (slug.length < 3 || slug.length > 40) {
    throw new NamespaceServiceError(
      'INVALID_INPUT',
      400,
      'namespace slug must contain between 3 and 40 characters',
    )
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new NamespaceServiceError(
      'INVALID_INPUT',
      400,
      'namespace slug may only contain lowercase letters, numbers, and single hyphens',
    )
  }
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
