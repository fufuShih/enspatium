import type { Kysely } from 'kysely'
import type { Readable } from 'node:stream'

import type { Database } from '../../db/index.js'
import type {
  PublicSpaceObject,
  SpaceObject,
} from '../../db/object.types.js'
import { createAuditEvent } from '../audit/audit.js'
import {
  getReadableObjectSpace,
  getWritableObjectSpace,
} from '../space/space.js'
import {
  deleteObjectFile,
  maximumObjectSizeBytes,
  normalizeObjectKey,
  normalizeObjectPrefix,
  ObjectStorageError,
  readObjectFile,
  type StoredObjectFile,
  writeObjectFile,
} from './storage.js'

const defaultContentType = 'application/octet-stream'
export const defaultObjectListLimit = 100
export const maximumObjectListLimit = 100

export type ObjectServiceErrorCode =
  | 'INVALID_INPUT'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'INTERNAL'

export class ObjectServiceError extends Error {
  constructor(
    readonly code: ObjectServiceErrorCode,
    readonly statusCode: number,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause })
    this.name = 'ObjectServiceError'
  }
}

export interface UploadObjectInput {
  key: string
  contentType?: string
  contentLength?: string
  source: Readable
}

export interface DownloadedObject {
  object: PublicSpaceObject
  stream: Readable
}

export async function uploadObject(
  db: Kysely<Database>,
  dataRoot: string,
  actorUserId: string,
  namespaceSlug: string,
  spaceSlug: string,
  input: UploadObjectInput,
): Promise<PublicSpaceObject> {
  const key = validateObjectKey(input.key)
  const contentType = normalizeContentType(input.contentType)
  const declaredSize = parseContentLength(input.contentLength)
  const space = await getWritableObjectSpace(
    db,
    actorUserId,
    namespaceSlug,
    spaceSlug,
  )

  try {
    const existingObject = await db
      .selectFrom('space_objects')
      .select('id')
      .where('space_id', '=', space.id)
      .where('key', '=', key)
      .executeTakeFirst()

    if (existingObject) {
      throw new ObjectServiceError(
        'CONFLICT',
        409,
        'object key already exists',
      )
    }
  } catch (error) {
    if (error instanceof ObjectServiceError) {
      throw error
    }

    throw new ObjectServiceError(
      'INTERNAL',
      500,
      'failed to check object key',
      error,
    )
  }

  let storedFile: StoredObjectFile

  try {
    storedFile = await writeObjectFile(
      dataRoot,
      space.id,
      key,
      input.source,
      declaredSize,
    )
  } catch (error) {
    throwObjectStorageError(error)
  }

  try {
    const object = await db.transaction().execute(async (transaction) => {
      const createdObject = await transaction
        .insertInto('space_objects')
        .values({
          space_id: space.id,
          created_by_user_id: actorUserId,
          key,
          content_type: contentType,
          size_bytes: storedFile.sizeBytes,
          checksum_sha256: storedFile.checksumSha256,
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      await createAuditEvent(transaction, {
        actorUserId,
        namespaceId: space.namespaceId,
        spaceId: space.id,
        action: 'object.uploaded',
        metadata: {
          objectId: createdObject.id,
          key: createdObject.key,
          contentType: createdObject.content_type,
          sizeBytes: createdObject.size_bytes,
          checksumSha256: createdObject.checksum_sha256,
        },
      })

      return createdObject
    })

    return toPublicSpaceObject(object)
  } catch (error) {
    let cause: unknown = error

    try {
      await deleteObjectFile(dataRoot, space.id, key)
    } catch (cleanupError) {
      cause = new AggregateError(
        [error, cleanupError],
        'database write and object cleanup both failed',
      )
    }

    if (isUniqueViolation(error)) {
      throw new ObjectServiceError(
        'CONFLICT',
        409,
        'object key already exists',
        cause,
      )
    }

    throw new ObjectServiceError(
      'INTERNAL',
      500,
      'failed to create object metadata',
      cause,
    )
  }
}

export async function listObjects(
  db: Kysely<Database>,
  actorUserId: string,
  namespaceSlug: string,
  spaceSlug: string,
  inputPrefix?: string,
  inputLimit?: number,
): Promise<PublicSpaceObject[]> {
  const prefix = validateObjectPrefix(inputPrefix)
  const limit = normalizeObjectListLimit(inputLimit)
  const space = await getReadableObjectSpace(
    db,
    actorUserId,
    namespaceSlug,
    spaceSlug,
  )

  try {
    let query = db
      .selectFrom('space_objects')
      .selectAll()
      .where('space_id', '=', space.id)

    if (prefix) {
      query = query.where('key', 'like', escapeLikePrefix(prefix) + '%')
    }

    const objects = await query.orderBy('key', 'asc').limit(limit).execute()

    return objects.map(toPublicSpaceObject)
  } catch (error) {
    throw new ObjectServiceError(
      'INTERNAL',
      500,
      'failed to list objects',
      error,
    )
  }
}

export async function downloadObject(
  db: Kysely<Database>,
  dataRoot: string,
  actorUserId: string | undefined,
  namespaceSlug: string,
  spaceSlug: string,
  inputKey: string,
): Promise<DownloadedObject> {
  const key = validateObjectKey(inputKey)
  const space = await getReadableObjectSpace(
    db,
    actorUserId,
    namespaceSlug,
    spaceSlug,
  )
  const object = await getObjectByKey(db, space.id, key)

  try {
    return {
      object: toPublicSpaceObject(object),
      stream: await readObjectFile(dataRoot, space.id, key),
    }
  } catch (error) {
    throwObjectStorageError(error)
  }
}

export async function deleteObject(
  db: Kysely<Database>,
  dataRoot: string,
  actorUserId: string,
  namespaceSlug: string,
  spaceSlug: string,
  inputKey: string,
): Promise<void> {
  const key = validateObjectKey(inputKey)
  const space = await getWritableObjectSpace(
    db,
    actorUserId,
    namespaceSlug,
    spaceSlug,
  )

  await getObjectByKey(db, space.id, key)

  try {
    await deleteObjectFile(dataRoot, space.id, key)
  } catch (error) {
    throwObjectStorageError(error)
  }

  try {
    await db.transaction().execute(async (transaction) => {
      const deletedObject = await transaction
        .deleteFrom('space_objects')
        .where('space_id', '=', space.id)
        .where('key', '=', key)
        .returningAll()
        .executeTakeFirst()

      if (!deletedObject) {
        throw new ObjectServiceError(
          'NOT_FOUND',
          404,
          'object was not found',
        )
      }

      await createAuditEvent(transaction, {
        actorUserId,
        namespaceId: space.namespaceId,
        spaceId: space.id,
        action: 'object.deleted',
        metadata: {
          objectId: deletedObject.id,
          key: deletedObject.key,
          contentType: deletedObject.content_type,
          sizeBytes: deletedObject.size_bytes,
          checksumSha256: deletedObject.checksum_sha256,
        },
      })
    })
  } catch (error) {
    if (error instanceof ObjectServiceError) {
      throw error
    }

    throw new ObjectServiceError(
      'INTERNAL',
      500,
      'failed to delete object metadata',
      error,
    )
  }
}

export function parseContentLength(input?: string): number | undefined {
  if (input === undefined) {
    return undefined
  }

  if (!/^\d+$/.test(input)) {
    throw new ObjectServiceError(
      'INVALID_INPUT',
      400,
      'content-length must be a non-negative integer',
    )
  }

  const size = Number(input)

  if (!Number.isSafeInteger(size)) {
    throw new ObjectServiceError(
      'INVALID_INPUT',
      400,
      'content-length is too large',
    )
  }

  if (size > maximumObjectSizeBytes) {
    throw new ObjectServiceError(
      'INVALID_INPUT',
      413,
      `object may not exceed ${maximumObjectSizeBytes} bytes`,
    )
  }

  return size
}

export function normalizeObjectListLimit(input?: number): number {
  if (input === undefined) {
    return defaultObjectListLimit
  }

  if (
    !Number.isInteger(input) ||
    input < 1 ||
    input > maximumObjectListLimit
  ) {
    throw new ObjectServiceError(
      'INVALID_INPUT',
      400,
      `limit must be an integer between 1 and ${maximumObjectListLimit}`,
    )
  }

  return input
}

function validateObjectKey(input: string): string {
  try {
    return normalizeObjectKey(input)
  } catch (error) {
    throwObjectStorageError(error)
  }
}

function validateObjectPrefix(input?: string): string {
  try {
    return normalizeObjectPrefix(input)
  } catch (error) {
    throwObjectStorageError(error)
  }
}

function normalizeContentType(input?: string): string {
  const contentType = input?.trim() || defaultContentType

  if (contentType.length > 255) {
    throw new ObjectServiceError(
      'INVALID_INPUT',
      400,
      'content-type may not exceed 255 characters',
    )
  }

  return contentType
}

function throwObjectStorageError(error: unknown): never {
  if (error instanceof ObjectStorageError) {
    if (error.code === 'INVALID_KEY') {
      throw new ObjectServiceError(
        'INVALID_INPUT',
        400,
        error.message,
        error,
      )
    }

    if (error.code === 'TOO_LARGE') {
      throw new ObjectServiceError(
        'INVALID_INPUT',
        413,
        error.message,
        error,
      )
    }

    if (error.code === 'ALREADY_EXISTS') {
      throw new ObjectServiceError('CONFLICT', 409, error.message, error)
    }

    if (error.code === 'NOT_FOUND') {
      throw new ObjectServiceError('NOT_FOUND', 404, error.message, error)
    }
  }

  throw new ObjectServiceError(
    'INTERNAL',
    500,
    'failed to store object',
    error,
  )
}

function toPublicSpaceObject(object: SpaceObject): PublicSpaceObject {
  return {
    id: object.id,
    spaceId: object.space_id,
    createdByUserId: object.created_by_user_id,
    key: object.key,
    contentType: object.content_type,
    sizeBytes: object.size_bytes,
    checksumSha256: object.checksum_sha256,
    createdAt: object.created_at.toISOString(),
    updatedAt: object.updated_at.toISOString(),
  }
}

async function getObjectByKey(
  db: Kysely<Database>,
  spaceId: string,
  key: string,
): Promise<SpaceObject> {
  try {
    const object = await db
      .selectFrom('space_objects')
      .selectAll()
      .where('space_id', '=', spaceId)
      .where('key', '=', key)
      .executeTakeFirst()

    if (!object) {
      throw new ObjectServiceError(
        'NOT_FOUND',
        404,
        'object was not found',
      )
    }

    return object
  } catch (error) {
    if (error instanceof ObjectServiceError) {
      throw error
    }

    throw new ObjectServiceError(
      'INTERNAL',
      500,
      'failed to get object metadata',
      error,
    )
  }
}

function escapeLikePrefix(input: string): string {
  return input.replace(/[\\%_]/g, '\\$&')
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  )
}
