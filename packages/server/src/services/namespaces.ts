import type { Kysely, Transaction } from 'kysely'

import type { Database } from '../db/index.js'
import type {
  AddNamespaceMemberInput,
  CreateOrganizationNamespaceInput,
  Namespace,
  NamespaceServiceErrorCode,
  PublicNamespace,
  PublicNamespaceMember,
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

    await transaction
      .insertInto('namespace_members')
      .values({
        namespace_id: namespace.id,
        user_id: ownerUserId,
        role: 'owner',
      })
      .execute()

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
    const namespace = await db.transaction().execute(async (transaction) => {
      const createdNamespace = await transaction
        .insertInto('namespaces')
        .values({
          owner_user_id: ownerUserId,
          name,
          slug,
          kind: 'organization',
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      await transaction
        .insertInto('namespace_members')
        .values({
          namespace_id: createdNamespace.id,
          user_id: ownerUserId,
          role: 'owner',
        })
        .execute()

      return createdNamespace
    })

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
      .innerJoin(
        'namespace_members',
        'namespace_members.namespace_id',
        'namespaces.id',
      )
      .selectAll('namespaces')
      .where('namespace_members.user_id', '=', ownerUserId)
      .orderBy('namespaces.created_at', 'asc')
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

export async function addNamespaceMember(
  db: Kysely<Database>,
  actorUserId: string,
  inputSlug: string,
  input: AddNamespaceMemberInput,
): Promise<PublicNamespaceMember> {
  const namespace = await requireOwnedOrganizationNamespace(
    db,
    actorUserId,
    inputSlug,
  )
  const email = input.email.trim().toLowerCase()

  validateNamespaceMemberEmail(email)

  try {
    const user = await db
      .selectFrom('users')
      .select(['id', 'email', 'display_name'])
      .where('email', '=', email)
      .executeTakeFirst()

    if (!user) {
      throw new NamespaceServiceError('NOT_FOUND', 404, 'user not found')
    }

    const membership = await db
      .insertInto('namespace_members')
      .values({
        namespace_id: namespace.id,
        user_id: user.id,
        role: 'member',
      })
      .returning(['role', 'created_at'])
      .executeTakeFirstOrThrow()

    return {
      userId: user.id,
      email: user.email,
      displayName: user.display_name,
      role: membership.role,
      joinedAt: membership.created_at.toISOString(),
    }
  } catch (error) {
    if (error instanceof NamespaceServiceError) {
      throw error
    }

    if (isUniqueViolation(error)) {
      throw new NamespaceServiceError(
        'CONFLICT',
        409,
        'user is already a namespace member',
      )
    }

    throw new NamespaceServiceError(
      'INTERNAL',
      500,
      'failed to add namespace member',
      error,
    )
  }
}

export async function listNamespaceMembers(
  db: Kysely<Database>,
  actorUserId: string,
  inputSlug: string,
): Promise<PublicNamespaceMember[]> {
  const namespace = await requireOwnedOrganizationNamespace(
    db,
    actorUserId,
    inputSlug,
  )

  try {
    const members = await db
      .selectFrom('namespace_members')
      .innerJoin('users', 'users.id', 'namespace_members.user_id')
      .select([
        'users.id as userId',
        'users.email',
        'users.display_name as displayName',
        'namespace_members.role',
        'namespace_members.created_at as joinedAt',
      ])
      .where('namespace_members.namespace_id', '=', namespace.id)
      .orderBy('namespace_members.created_at', 'asc')
      .execute()

    return members.map((member) => ({
      ...member,
      joinedAt: member.joinedAt.toISOString(),
    }))
  } catch (error) {
    throw new NamespaceServiceError(
      'INTERNAL',
      500,
      'failed to list namespace members',
      error,
    )
  }
}

export async function removeNamespaceMember(
  db: Kysely<Database>,
  actorUserId: string,
  inputSlug: string,
  memberUserId: string,
): Promise<void> {
  const namespace = await requireOwnedOrganizationNamespace(
    db,
    actorUserId,
    inputSlug,
  )

  if (namespace.owner_user_id === memberUserId) {
    throw new NamespaceServiceError(
      'CONFLICT',
      409,
      'namespace owner cannot be removed',
    )
  }

  try {
    await db.transaction().execute(async (transaction) => {
      const removedMember = await transaction
        .deleteFrom('namespace_members')
        .where('namespace_id', '=', namespace.id)
        .where('user_id', '=', memberUserId)
        .where('role', '=', 'member')
        .returning('user_id')
        .executeTakeFirst()

      if (!removedMember) {
        throw new NamespaceServiceError(
          'NOT_FOUND',
          404,
          'namespace member not found',
        )
      }

      await transaction
        .deleteFrom('space_members')
        .where('user_id', '=', memberUserId)
        .where(
          'space_id',
          'in',
          transaction
            .selectFrom('spaces')
            .select('id')
            .where('namespace_id', '=', namespace.id),
        )
        .execute()
    })
  } catch (error) {
    if (error instanceof NamespaceServiceError) {
      throw error
    }

    throw new NamespaceServiceError(
      'INTERNAL',
      500,
      'failed to remove namespace member',
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

export function validateNamespaceMemberEmail(email: string): void {
  if (
    !email ||
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new NamespaceServiceError(
      'INVALID_INPUT',
      400,
      'a valid email is required',
    )
  }
}

async function requireOwnedOrganizationNamespace(
  db: Kysely<Database>,
  actorUserId: string,
  inputSlug: string,
) {
  const slug = normalizeNamespaceSlug(inputSlug)

  validateNamespaceSlug(slug)

  let namespace

  try {
    namespace = await db
      .selectFrom('namespaces')
      .select(['id', 'kind', 'owner_user_id'])
      .where('slug', '=', slug)
      .executeTakeFirst()
  } catch (error) {
    throw new NamespaceServiceError(
      'INTERNAL',
      500,
      'failed to check namespace permission',
      error,
    )
  }

  if (!namespace) {
    throw new NamespaceServiceError('NOT_FOUND', 404, 'namespace not found')
  }

  if (namespace.kind !== 'organization') {
    throw new NamespaceServiceError(
      'INVALID_INPUT',
      400,
      'personal namespaces do not support additional members',
    )
  }

  if (namespace.owner_user_id !== actorUserId) {
    throw new NamespaceServiceError(
      'FORBIDDEN',
      403,
      'namespace owner permission is required',
    )
  }

  return namespace
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
