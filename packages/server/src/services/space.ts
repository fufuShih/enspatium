import type { Kysely } from 'kysely'

import type { Database } from '../db/index.js'
import type {
  CreateSpaceInput,
  PublicSpace,
  Space,
  SpaceServiceErrorCode,
} from '../db/space.types.js'

export class SpaceServiceError extends Error {
  constructor(
    readonly code: SpaceServiceErrorCode,
    readonly statusCode: number,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause })
    this.name = 'SpaceServiceError'
  }
}

export async function createSpace(
  db: Kysely<Database>,
  actorUserId: string,
  inputNamespaceSlug: string,
  input: CreateSpaceInput,
): Promise<PublicSpace> {
  const name = input.name.trim()
  const slug = normalizeSpaceSlug(input.slug)
  const visibility = input.visibility ?? 'private'

  validateSpace(name, slug, input.type, visibility)

  const namespace = await requireNamespaceMembership(
    db,
    actorUserId,
    inputNamespaceSlug,
  )

  if (namespace.memberRole !== 'owner') {
    throw new SpaceServiceError(
      'FORBIDDEN',
      403,
      'namespace owner permission is required',
    )
  }

  try {
    const space = await db
      .insertInto('spaces')
      .values({
        namespace_id: namespace.id,
        created_by_user_id: actorUserId,
        name,
        slug,
        type: input.type,
        visibility,
      })
      .returningAll()
      .executeTakeFirstOrThrow()

    return toPublicSpace(space)
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new SpaceServiceError(
        'CONFLICT',
        409,
        'space slug already exists in this namespace',
      )
    }

    throw new SpaceServiceError(
      'INTERNAL',
      500,
      'failed to create space',
      error,
    )
  }
}

export async function listSpaces(
  db: Kysely<Database>,
  actorUserId: string,
  inputNamespaceSlug: string,
): Promise<PublicSpace[]> {
  const namespace = await requireNamespaceMembership(
    db,
    actorUserId,
    inputNamespaceSlug,
  )

  try {
    const spaces = await db
      .selectFrom('spaces')
      .selectAll()
      .where('namespace_id', '=', namespace.id)
      .orderBy('created_at', 'asc')
      .execute()

    return spaces.map(toPublicSpace)
  } catch (error) {
    throw new SpaceServiceError(
      'INTERNAL',
      500,
      'failed to list spaces',
      error,
    )
  }
}

export async function getSpaceBySlug(
  db: Kysely<Database>,
  actorUserId: string | undefined,
  inputNamespaceSlug: string,
  inputSpaceSlug: string,
): Promise<PublicSpace> {
  const namespaceSlug = normalizeSpaceSlug(inputNamespaceSlug)
  const spaceSlug = normalizeSpaceSlug(inputSpaceSlug)

  validateSlug(namespaceSlug, 'namespace')
  validateSlug(spaceSlug, 'space')

  try {
    const space = await db
      .selectFrom('spaces')
      .innerJoin('namespaces', 'namespaces.id', 'spaces.namespace_id')
      .selectAll('spaces')
      .where('namespaces.slug', '=', namespaceSlug)
      .where('spaces.slug', '=', spaceSlug)
      .executeTakeFirst()

    if (!space) {
      throw new SpaceServiceError('NOT_FOUND', 404, 'space not found')
    }

    if (space.visibility === 'public') {
      return toPublicSpace(space)
    }

    if (!actorUserId) {
      throw new SpaceServiceError(
        'UNAUTHENTICATED',
        401,
        'authentication required',
      )
    }

    const membership = await db
      .selectFrom('namespace_members')
      .select('user_id')
      .where('namespace_id', '=', space.namespace_id)
      .where('user_id', '=', actorUserId)
      .executeTakeFirst()

    if (!membership) {
      throw new SpaceServiceError(
        'FORBIDDEN',
        403,
        'namespace membership is required',
      )
    }

    return toPublicSpace(space)
  } catch (error) {
    if (error instanceof SpaceServiceError) {
      throw error
    }

    throw new SpaceServiceError(
      'INTERNAL',
      500,
      'failed to get space',
      error,
    )
  }
}

export function normalizeSpaceSlug(slug: string): string {
  return slug.trim().toLowerCase()
}

export function validateSpace(
  name: string,
  slug: string,
  type: string,
  visibility: string,
): void {
  if (!name) {
    throw new SpaceServiceError(
      'INVALID_INPUT',
      400,
      'space name is required',
    )
  }

  if (name.length > 100) {
    throw new SpaceServiceError(
      'INVALID_INPUT',
      400,
      'space name must contain at most 100 characters',
    )
  }

  validateSlug(slug, 'space')

  if (type !== 'git' && type !== 'object') {
    throw new SpaceServiceError(
      'INVALID_INPUT',
      400,
      'space type must be git or object',
    )
  }

  if (visibility !== 'public' && visibility !== 'private') {
    throw new SpaceServiceError(
      'INVALID_INPUT',
      400,
      'space visibility must be public or private',
    )
  }
}

async function requireNamespaceMembership(
  db: Kysely<Database>,
  actorUserId: string,
  inputNamespaceSlug: string,
) {
  const namespaceSlug = normalizeSpaceSlug(inputNamespaceSlug)

  validateSlug(namespaceSlug, 'namespace')

  try {
    const namespace = await db
      .selectFrom('namespaces')
      .select('id')
      .where('slug', '=', namespaceSlug)
      .executeTakeFirst()

    if (!namespace) {
      throw new SpaceServiceError(
        'NOT_FOUND',
        404,
        'namespace not found',
      )
    }

    const membership = await db
      .selectFrom('namespace_members')
      .select('role')
      .where('namespace_id', '=', namespace.id)
      .where('user_id', '=', actorUserId)
      .executeTakeFirst()

    if (!membership) {
      throw new SpaceServiceError(
        'FORBIDDEN',
        403,
        'namespace membership is required',
      )
    }

    return {
      id: namespace.id,
      memberRole: membership.role,
    }
  } catch (error) {
    if (error instanceof SpaceServiceError) {
      throw error
    }

    throw new SpaceServiceError(
      'INTERNAL',
      500,
      'failed to check namespace membership',
      error,
    )
  }
}

function validateSlug(slug: string, subject: 'namespace' | 'space'): void {
  if (slug.length < 3 || slug.length > 40) {
    throw new SpaceServiceError(
      'INVALID_INPUT',
      400,
      `${subject} slug must contain between 3 and 40 characters`,
    )
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new SpaceServiceError(
      'INVALID_INPUT',
      400,
      `${subject} slug may only contain lowercase letters, numbers, and single hyphens`,
    )
  }
}

function toPublicSpace(space: Space): PublicSpace {
  return {
    id: space.id,
    namespaceId: space.namespace_id,
    createdByUserId: space.created_by_user_id,
    name: space.name,
    slug: space.slug,
    type: space.type,
    visibility: space.visibility,
    createdAt: space.created_at.toISOString(),
    updatedAt: space.updated_at.toISOString(),
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
