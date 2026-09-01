import type { Kysely } from 'kysely'

import type { Database } from '../db/index.js'
import type {
  AddSpaceMemberInput,
  CreateSpaceInput,
  PublicSpace,
  PublicSpaceMember,
  Space,
  SpaceMemberRole,
  SpaceServiceErrorCode,
  UpdateSpaceMemberInput,
  UpdateSpaceInput,
} from '../db/space.types.js'
import {
  getGitCommit,
  getGitDiff,
  getGitFile,
  getGitReadme,
  getGitRepositoryInfo,
  getGitTags,
  getGitTree,
  GitStorageError,
  type GitCommitDetail,
  type GitDiff,
  type GitFile,
  type GitRepositoryInfo,
  type GitTag,
  type GitTree,
} from './git/repository.js'
import { createSpaceStorage, deleteSpaceStorage } from '../storage.js'

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
  dataRoot: string,
  actorUserId: string,
  inputNamespaceSlug: string,
  input: CreateSpaceInput,
): Promise<PublicSpace> {
  const name = input.name.trim()
  const slug = normalizeSpaceSlug(input.slug)
  const visibility = input.visibility ?? 'private'

  validateSpace(name, slug, input.type, visibility)

  const namespace = await requireNamespaceOwner(
    db,
    actorUserId,
    inputNamespaceSlug,
  )

  let space: Space

  try {
    space = await db.transaction().execute(async (transaction) => {
      const createdSpace = await transaction
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

      await transaction
        .insertInto('space_members')
        .values({
          space_id: createdSpace.id,
          user_id: actorUserId,
          role: 'owner',
        })
        .execute()

      return createdSpace
    })
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

  try {
    await createSpaceStorage(dataRoot, space.id, space.type)
  } catch (storageError) {
    let cause: unknown = storageError

    try {
      await db.deleteFrom('spaces').where('id', '=', space.id).execute()
    } catch (cleanupError) {
      cause = new AggregateError(
        [storageError, cleanupError],
        'storage creation and database cleanup both failed',
      )
    }

    throw new SpaceServiceError(
      'INTERNAL',
      500,
      'failed to create space storage',
      cause,
    )
  }

  return toPublicSpace(space)
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
    const spaces =
      namespace.memberRole === 'owner'
        ? await db
            .selectFrom('spaces')
            .selectAll()
            .where('namespace_id', '=', namespace.id)
            .orderBy('created_at', 'asc')
            .execute()
        : await db
            .selectFrom('spaces')
            .leftJoin('space_members', (join) =>
              join
                .onRef('space_members.space_id', '=', 'spaces.id')
                .on('space_members.user_id', '=', actorUserId),
            )
            .selectAll('spaces')
            .where('spaces.namespace_id', '=', namespace.id)
            .where((expression) =>
              expression.or([
                expression('spaces.visibility', '=', 'public'),
                expression('space_members.user_id', '=', actorUserId),
              ]),
            )
            .orderBy('spaces.created_at', 'asc')
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

    const namespace = await requireNamespaceMembership(
      db,
      actorUserId,
      namespaceSlug,
    )

    if (namespace.memberRole === 'owner') {
      return toPublicSpace(space)
    }

    const spaceMembership = await db
      .selectFrom('space_members')
      .select('role')
      .where('space_id', '=', space.id)
      .where('user_id', '=', actorUserId)
      .executeTakeFirst()

    if (!spaceMembership) {
      throw new SpaceServiceError(
        'FORBIDDEN',
        403,
        'space membership is required',
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

export async function getGitSpaceInfo(
  db: Kysely<Database>,
  dataRoot: string,
  actorUserId: string | undefined,
  inputNamespaceSlug: string,
  inputSpaceSlug: string,
): Promise<GitRepositoryInfo> {
  const space = await getReadableGitSpace(
    db,
    actorUserId,
    inputNamespaceSlug,
    inputSpaceSlug,
  )

  try {
    return await getGitRepositoryInfo(dataRoot, space.id)
  } catch (error) {
    throwGitStorageError(error, 'failed to read Git repository')
  }
}

export async function getGitSpaceTags(
  db: Kysely<Database>,
  dataRoot: string,
  actorUserId: string | undefined,
  inputNamespaceSlug: string,
  inputSpaceSlug: string,
): Promise<GitTag[]> {
  const space = await getReadableGitSpace(
    db,
    actorUserId,
    inputNamespaceSlug,
    inputSpaceSlug,
  )

  try {
    return await getGitTags(dataRoot, space.id)
  } catch (error) {
    throwGitStorageError(error, 'failed to read Git tags')
  }
}

export async function getGitSpaceCommit(
  db: Kysely<Database>,
  dataRoot: string,
  actorUserId: string | undefined,
  inputNamespaceSlug: string,
  inputSpaceSlug: string,
  inputRef?: string,
): Promise<GitCommitDetail> {
  const space = await getReadableGitSpace(
    db,
    actorUserId,
    inputNamespaceSlug,
    inputSpaceSlug,
  )

  try {
    return await getGitCommit(dataRoot, space.id, inputRef)
  } catch (error) {
    throwGitStorageError(error, 'failed to read Git commit')
  }
}

export async function getGitSpaceDiff(
  db: Kysely<Database>,
  dataRoot: string,
  actorUserId: string | undefined,
  inputNamespaceSlug: string,
  inputSpaceSlug: string,
  inputFromRef: string,
  inputToRef: string,
): Promise<GitDiff> {
  const space = await getReadableGitSpace(
    db,
    actorUserId,
    inputNamespaceSlug,
    inputSpaceSlug,
  )

  try {
    return await getGitDiff(
      dataRoot,
      space.id,
      inputFromRef,
      inputToRef,
    )
  } catch (error) {
    throwGitStorageError(error, 'failed to read Git diff')
  }
}

export async function getGitSpaceTree(
  db: Kysely<Database>,
  dataRoot: string,
  actorUserId: string | undefined,
  inputNamespaceSlug: string,
  inputSpaceSlug: string,
  inputRef?: string,
  inputPath = '',
): Promise<GitTree> {
  const space = await getReadableGitSpace(
    db,
    actorUserId,
    inputNamespaceSlug,
    inputSpaceSlug,
  )

  try {
    return await getGitTree(dataRoot, space.id, inputRef, inputPath)
  } catch (error) {
    throwGitStorageError(error, 'failed to read Git tree')
  }
}

export async function getGitSpaceFile(
  db: Kysely<Database>,
  dataRoot: string,
  actorUserId: string | undefined,
  inputNamespaceSlug: string,
  inputSpaceSlug: string,
  inputRef: string | undefined,
  inputPath: string,
): Promise<GitFile> {
  const space = await getReadableGitSpace(
    db,
    actorUserId,
    inputNamespaceSlug,
    inputSpaceSlug,
  )

  try {
    return await getGitFile(dataRoot, space.id, inputRef, inputPath)
  } catch (error) {
    throwGitStorageError(error, 'failed to read Git file')
  }
}

export async function getGitSpaceReadme(
  db: Kysely<Database>,
  dataRoot: string,
  actorUserId: string | undefined,
  inputNamespaceSlug: string,
  inputSpaceSlug: string,
  inputRef?: string,
): Promise<GitFile | null> {
  const space = await getReadableGitSpace(
    db,
    actorUserId,
    inputNamespaceSlug,
    inputSpaceSlug,
  )

  try {
    return await getGitReadme(dataRoot, space.id, inputRef)
  } catch (error) {
    throwGitStorageError(error, 'failed to read Git README')
  }
}

export async function getReadableGitSpace(
  db: Kysely<Database>,
  actorUserId: string | undefined,
  inputNamespaceSlug: string,
  inputSpaceSlug: string,
): Promise<PublicSpace> {
  const space = await getSpaceBySlug(
    db,
    actorUserId,
    inputNamespaceSlug,
    inputSpaceSlug,
  )

  if (space.type !== 'git') {
    throw new SpaceServiceError(
      'INVALID_INPUT',
      400,
      'space is not a Git space',
    )
  }

  return space
}

export async function getWritableGitSpace(
  db: Kysely<Database>,
  actorUserId: string,
  inputNamespaceSlug: string,
  inputSpaceSlug: string,
): Promise<Pick<PublicSpace, 'id'>> {
  const spaceSlug = normalizeSpaceSlug(inputSpaceSlug)

  validateSlug(spaceSlug, 'space')

  const namespace = await requireNamespaceMembership(
    db,
    actorUserId,
    inputNamespaceSlug,
  )

  try {
    const space = await db
      .selectFrom('spaces')
      .select(['id', 'type'])
      .where('namespace_id', '=', namespace.id)
      .where('slug', '=', spaceSlug)
      .executeTakeFirst()

    if (!space) {
      throw new SpaceServiceError('NOT_FOUND', 404, 'space not found')
    }

    if (space.type !== 'git') {
      throw new SpaceServiceError(
        'INVALID_INPUT',
        400,
        'space is not a Git space',
      )
    }

    if (namespace.memberRole === 'owner') {
      return { id: space.id }
    }

    const membership = await db
      .selectFrom('space_members')
      .select('role')
      .where('space_id', '=', space.id)
      .where('user_id', '=', actorUserId)
      .executeTakeFirst()

    validateGitWriteRole(membership?.role)

    return { id: space.id }
  } catch (error) {
    if (error instanceof SpaceServiceError) {
      throw error
    }

    throw new SpaceServiceError(
      'INTERNAL',
      500,
      'failed to check Git write permission',
      error,
    )
  }
}

export function validateGitWriteRole(
  role: SpaceMemberRole | undefined,
): void {
  if (role !== 'owner' && role !== 'writer') {
    throw new SpaceServiceError(
      'FORBIDDEN',
      403,
      'Git write permission is required',
    )
  }
}

function throwGitStorageError(error: unknown, message: string): never {
  if (error instanceof GitStorageError) {
    if (error.code === 'REF_NOT_FOUND' || error.code === 'PATH_NOT_FOUND') {
      throw new SpaceServiceError('NOT_FOUND', 404, error.message, error)
    }

    if (
      error.code === 'FILE_TOO_LARGE' ||
      error.code === 'DIFF_TOO_LARGE'
    ) {
      throw new SpaceServiceError('INVALID_INPUT', 413, error.message, error)
    }

    throw new SpaceServiceError('INVALID_INPUT', 400, error.message, error)
  }

  throw new SpaceServiceError('INTERNAL', 500, message, error)
}

export async function updateSpace(
  db: Kysely<Database>,
  actorUserId: string,
  inputNamespaceSlug: string,
  inputSpaceSlug: string,
  input: UpdateSpaceInput,
): Promise<PublicSpace> {
  const spaceSlug = normalizeSpaceSlug(inputSpaceSlug)
  const name = input.name?.trim()
  const normalizedInput: UpdateSpaceInput = {}

  if (name !== undefined) {
    normalizedInput.name = name
  }

  if (input.visibility !== undefined) {
    normalizedInput.visibility = input.visibility
  }

  validateSlug(spaceSlug, 'space')
  validateSpaceUpdate(normalizedInput)

  const spaceAccess = await requireSpaceOwnerAccess(
    db,
    actorUserId,
    inputNamespaceSlug,
    spaceSlug,
  )

  try {
    const space = await db
      .updateTable('spaces')
      .set({
        ...(normalizedInput.name !== undefined
          ? { name: normalizedInput.name }
          : {}),
        ...(normalizedInput.visibility !== undefined
          ? { visibility: normalizedInput.visibility }
          : {}),
        updated_at: new Date(),
      })
      .where('id', '=', spaceAccess.spaceId)
      .returningAll()
      .executeTakeFirst()

    if (!space) {
      throw new SpaceServiceError('NOT_FOUND', 404, 'space not found')
    }

    return toPublicSpace(space)
  } catch (error) {
    if (error instanceof SpaceServiceError) {
      throw error
    }

    throw new SpaceServiceError(
      'INTERNAL',
      500,
      'failed to update space',
      error,
    )
  }
}

export async function deleteSpace(
  db: Kysely<Database>,
  dataRoot: string,
  actorUserId: string,
  inputNamespaceSlug: string,
  inputSpaceSlug: string,
): Promise<void> {
  const spaceSlug = normalizeSpaceSlug(inputSpaceSlug)

  validateSlug(spaceSlug, 'space')

  const spaceAccess = await requireSpaceOwnerAccess(
    db,
    actorUserId,
    inputNamespaceSlug,
    spaceSlug,
  )

  try {
    await deleteSpaceStorage(
      dataRoot,
      spaceAccess.spaceId,
      spaceAccess.spaceType,
    )
  } catch (error) {
    throw new SpaceServiceError(
      'INTERNAL',
      500,
      'failed to delete space storage',
      error,
    )
  }

  try {
    const deletedSpace = await db
      .deleteFrom('spaces')
      .where('id', '=', spaceAccess.spaceId)
      .returning('id')
      .executeTakeFirst()

    if (!deletedSpace) {
      throw new SpaceServiceError('NOT_FOUND', 404, 'space not found')
    }
  } catch (error) {
    if (error instanceof SpaceServiceError) {
      throw error
    }

    throw new SpaceServiceError(
      'INTERNAL',
      500,
      'failed to delete space',
      error,
    )
  }
}

export async function addSpaceMember(
  db: Kysely<Database>,
  actorUserId: string,
  inputNamespaceSlug: string,
  inputSpaceSlug: string,
  input: AddSpaceMemberInput,
): Promise<PublicSpaceMember> {
  const email = input.email.trim().toLowerCase()

  validateSpaceMemberEmail(email)
  validateAssignableSpaceMemberRole(input.role)

  const spaceAccess = await requireSpaceOwnerAccess(
    db,
    actorUserId,
    inputNamespaceSlug,
    inputSpaceSlug,
  )

  try {
    const user = await db
      .selectFrom('users')
      .innerJoin(
        'namespace_members',
        'namespace_members.user_id',
        'users.id',
      )
      .select(['users.id', 'users.email', 'users.display_name'])
      .where('users.email', '=', email)
      .where('namespace_members.namespace_id', '=', spaceAccess.namespaceId)
      .executeTakeFirst()

    if (!user) {
      throw new SpaceServiceError(
        'NOT_FOUND',
        404,
        'namespace member not found',
      )
    }

    const membership = await db
      .insertInto('space_members')
      .values({
        space_id: spaceAccess.spaceId,
        user_id: user.id,
        role: input.role,
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
    if (error instanceof SpaceServiceError) {
      throw error
    }

    if (isUniqueViolation(error)) {
      throw new SpaceServiceError(
        'CONFLICT',
        409,
        'user is already a space member',
      )
    }

    throw new SpaceServiceError(
      'INTERNAL',
      500,
      'failed to add space member',
      error,
    )
  }
}

export async function listSpaceMembers(
  db: Kysely<Database>,
  actorUserId: string,
  inputNamespaceSlug: string,
  inputSpaceSlug: string,
): Promise<PublicSpaceMember[]> {
  const spaceAccess = await requireSpaceOwnerAccess(
    db,
    actorUserId,
    inputNamespaceSlug,
    inputSpaceSlug,
  )

  try {
    const members = await db
      .selectFrom('space_members')
      .innerJoin('users', 'users.id', 'space_members.user_id')
      .select([
        'users.id as userId',
        'users.email',
        'users.display_name as displayName',
        'space_members.role',
        'space_members.created_at as joinedAt',
      ])
      .where('space_members.space_id', '=', spaceAccess.spaceId)
      .orderBy('space_members.created_at', 'asc')
      .execute()

    return members.map((member) => ({
      ...member,
      joinedAt: member.joinedAt.toISOString(),
    }))
  } catch (error) {
    throw new SpaceServiceError(
      'INTERNAL',
      500,
      'failed to list space members',
      error,
    )
  }
}

export async function updateSpaceMember(
  db: Kysely<Database>,
  actorUserId: string,
  inputNamespaceSlug: string,
  inputSpaceSlug: string,
  memberUserId: string,
  input: UpdateSpaceMemberInput,
): Promise<PublicSpaceMember> {
  validateAssignableSpaceMemberRole(input.role)

  const spaceAccess = await requireSpaceOwnerAccess(
    db,
    actorUserId,
    inputNamespaceSlug,
    inputSpaceSlug,
  )

  try {
    const member = await db
      .selectFrom('space_members')
      .innerJoin('users', 'users.id', 'space_members.user_id')
      .select([
        'users.id as userId',
        'users.email',
        'users.display_name as displayName',
        'space_members.role',
        'space_members.created_at as joinedAt',
      ])
      .where('space_members.space_id', '=', spaceAccess.spaceId)
      .where('space_members.user_id', '=', memberUserId)
      .executeTakeFirst()

    if (!member) {
      throw new SpaceServiceError(
        'NOT_FOUND',
        404,
        'space member not found',
      )
    }

    if (member.role === 'owner') {
      throw new SpaceServiceError(
        'CONFLICT',
        409,
        'space owner role cannot be changed',
      )
    }

    const updatedMembership = await db
      .updateTable('space_members')
      .set({ role: input.role })
      .where('space_id', '=', spaceAccess.spaceId)
      .where('user_id', '=', memberUserId)
      .returning('role')
      .executeTakeFirstOrThrow()

    return {
      userId: member.userId,
      email: member.email,
      displayName: member.displayName,
      role: updatedMembership.role,
      joinedAt: member.joinedAt.toISOString(),
    }
  } catch (error) {
    if (error instanceof SpaceServiceError) {
      throw error
    }

    throw new SpaceServiceError(
      'INTERNAL',
      500,
      'failed to update space member',
      error,
    )
  }
}

export async function removeSpaceMember(
  db: Kysely<Database>,
  actorUserId: string,
  inputNamespaceSlug: string,
  inputSpaceSlug: string,
  memberUserId: string,
): Promise<void> {
  const spaceAccess = await requireSpaceOwnerAccess(
    db,
    actorUserId,
    inputNamespaceSlug,
    inputSpaceSlug,
  )

  try {
    const membership = await db
      .selectFrom('space_members')
      .select('role')
      .where('space_id', '=', spaceAccess.spaceId)
      .where('user_id', '=', memberUserId)
      .executeTakeFirst()

    if (!membership) {
      throw new SpaceServiceError(
        'NOT_FOUND',
        404,
        'space member not found',
      )
    }

    if (membership.role === 'owner') {
      throw new SpaceServiceError(
        'CONFLICT',
        409,
        'space owner cannot be removed',
      )
    }

    await db
      .deleteFrom('space_members')
      .where('space_id', '=', spaceAccess.spaceId)
      .where('user_id', '=', memberUserId)
      .execute()
  } catch (error) {
    if (error instanceof SpaceServiceError) {
      throw error
    }

    throw new SpaceServiceError(
      'INTERNAL',
      500,
      'failed to remove space member',
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

export function validateSpaceUpdate(input: UpdateSpaceInput): void {
  if (input.name === undefined && input.visibility === undefined) {
    throw new SpaceServiceError(
      'INVALID_INPUT',
      400,
      'at least one space field is required',
    )
  }

  if (input.name !== undefined) {
    if (!input.name) {
      throw new SpaceServiceError(
        'INVALID_INPUT',
        400,
        'space name is required',
      )
    }

    if (input.name.length > 100) {
      throw new SpaceServiceError(
        'INVALID_INPUT',
        400,
        'space name must contain at most 100 characters',
      )
    }
  }

  if (
    input.visibility !== undefined &&
    input.visibility !== 'public' &&
    input.visibility !== 'private'
  ) {
    throw new SpaceServiceError(
      'INVALID_INPUT',
      400,
      'space visibility must be public or private',
    )
  }
}

export function validateSpaceMemberEmail(email: string): void {
  if (
    !email ||
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new SpaceServiceError(
      'INVALID_INPUT',
      400,
      'a valid email is required',
    )
  }
}

export function validateAssignableSpaceMemberRole(role: string): void {
  if (role !== 'writer' && role !== 'reader') {
    throw new SpaceServiceError(
      'INVALID_INPUT',
      400,
      'space member role must be writer or reader',
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

async function requireNamespaceOwner(
  db: Kysely<Database>,
  actorUserId: string,
  inputNamespaceSlug: string,
) {
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

  return namespace
}

async function requireSpaceOwnerAccess(
  db: Kysely<Database>,
  actorUserId: string,
  inputNamespaceSlug: string,
  inputSpaceSlug: string,
) {
  const spaceSlug = normalizeSpaceSlug(inputSpaceSlug)

  validateSlug(spaceSlug, 'space')

  const namespace = await requireNamespaceMembership(
    db,
    actorUserId,
    inputNamespaceSlug,
  )

  try {
    const space = await db
      .selectFrom('spaces')
      .select(['id', 'type'])
      .where('namespace_id', '=', namespace.id)
      .where('slug', '=', spaceSlug)
      .executeTakeFirst()

    if (!space) {
      throw new SpaceServiceError('NOT_FOUND', 404, 'space not found')
    }

    if (namespace.memberRole === 'owner') {
      return {
        namespaceId: namespace.id,
        spaceId: space.id,
        spaceType: space.type,
      }
    }

    const membership = await db
      .selectFrom('space_members')
      .select('role')
      .where('space_id', '=', space.id)
      .where('user_id', '=', actorUserId)
      .executeTakeFirst()

    if (membership?.role !== 'owner') {
      throw new SpaceServiceError(
        'FORBIDDEN',
        403,
        'space owner permission is required',
      )
    }

    return {
      namespaceId: namespace.id,
      spaceId: space.id,
      spaceType: space.type,
    }
  } catch (error) {
    if (error instanceof SpaceServiceError) {
      throw error
    }

    throw new SpaceServiceError(
      'INTERNAL',
      500,
      'failed to check space permission',
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
