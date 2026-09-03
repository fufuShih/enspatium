import type { Kysely } from 'kysely'
import type { Readable } from 'node:stream'

import type { Database } from '../../db/index.js'
import type {
  PublicSpaceObject,
  SpaceObject,
} from '../../db/object.types.js'
import { createAuditEvent } from '../audit/audit.js'
import { getWritableObjectSpace } from '../space/space.js'
import {
  deleteObjectFile,
  maximumObjectSizeBytes,
  normalizeObjectKey,
  ObjectStorageError,
  writeObjectFile,
} from './storage.js'

const defaultContentType = 'application/octet-stream'

export type ObjectServiceErrorCode =
  | 'INVALID_INPUT'
  | 'CONFLICT'
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

  let storedFile

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

function validateObjectKey(input: string): string {
  try {
    return normalizeObjectKey(input)
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

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  )
}
