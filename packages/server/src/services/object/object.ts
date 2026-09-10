import { sql, type Kysely } from 'kysely'
import type { Readable } from 'node:stream'

import type { Database } from '../../db/index.js'
import type {
  ObjectStorageUsage,
  PublicSpaceObject,
  SpaceObject,
} from '../../db/object.types.js'
import { requireSpaceStorage, SpaceStorageUnavailable } from '../space/storage.js'
import {
  getReadableObjectSpace,
} from '../space/space.js'
import {
  maximumObjectSizeBytes,
  normalizeObjectKey,
  normalizeObjectPrefix,
  ObjectStorageError,
  openObjectFile,
} from './storage.js'

const defaultContentType = 'application/octet-stream'
export const defaultObjectListLimit = 100
export const maximumObjectListLimit = 100

export type ObjectServiceErrorCode =
  | 'INVALID_INPUT'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'OBJECT_CONTENT_MISSING'
  | 'OBJECT_CONTENT_CORRUPT'
  | 'QUOTA_EXCEEDED'
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
  expectedVersion?: string
}

export interface DownloadedObject {
  object: PublicSpaceObject
  stream: Readable
}

export interface ObjectFolderPage {
  prefix: string
  folders: string[]
  objects: PublicSpaceObject[]
  nextCursor: string | null
}

export async function browseObjects(
  db: Kysely<Database>, dataRoot: string, actorUserId: string,
  namespaceSlug: string, spaceSlug: string,
  input: { prefix?: string; filter?: string; cursor?: string; limit?: number; deleted?: boolean },
): Promise<ObjectFolderPage> {
  const prefix = validateObjectPrefix(input.prefix)
  const filter = validateObjectPrefix(input.filter)
  const cursor = validateObjectPrefix(input.cursor)
  const limit = normalizeObjectListLimit(input.limit)
  const cursorName = cursor.slice(prefix.length).replace(/\/$/, '')
  const invalidCursor = cursor && (!cursor.startsWith(prefix) || !cursorName || cursorName.includes('/'))
  if ((prefix && !prefix.endsWith('/')) || filter.includes('/') || invalidCursor) {
    throw new ObjectServiceError('INVALID_INPUT', 400, 'Invalid folder path or cursor')
  }
  const match = validateObjectPrefix(prefix + filter)
  const space = await getReadableObjectSpace(db, actorUserId, namespaceSlug, spaceSlug)
  await requireSpaceStorage(dataRoot, space.id, 'object')
  try {
    // Group the complete matching key set BEFORE pagination, so a folder with
    // many descendants cannot hide other folders. char_length handles Unicode.
    const cursorFolder = cursor.endsWith('/')
    const after = cursor ? sql`where (entries.is_folder = ${cursorFolder} and entries.entry_key collate "C" > ${cursor} collate "C")
      or (not entries.is_folder and ${cursorFolder})` : sql``
    const result = await sql<SpaceObject & { entry_key: string; is_folder: boolean }>`
      with children as (
        select distinct case
          when strpos(substr(key, char_length(${prefix}::text) + 1), '/') > 0
          then left(key, char_length(${prefix}::text) + strpos(substr(key, char_length(${prefix}::text) + 1), '/'))
          else key end as entry_key
        from space_objects where space_id = ${space.id} and is_deleted = ${input.deleted ?? false} and key like ${escapeLikePrefix(match) + '%'}
      ), entries as (
        select entry_key, right(entry_key, 1) = '/' as is_folder from children
      )
      select entries.entry_key, entries.is_folder, objects.*
      from entries left join space_objects objects
        on objects.space_id = ${space.id} and objects.key = entries.entry_key and not entries.is_folder
      ${after}
      order by entries.is_folder desc, entries.entry_key collate "C" asc
      limit ${limit + 1}
    `.execute(db)
    const page = result.rows.slice(0, limit)
    return {
      prefix,
      folders: page.filter(row => row.is_folder).map(row => row.entry_key),
      objects: page.filter(row => !row.is_folder && row.id).map(toPublicSpaceObject),
      nextCursor: result.rows.length > limit ? page.at(-1)!.entry_key : null,
    }
  } catch (error) {
    throw new ObjectServiceError('INTERNAL', 500, 'failed to browse objects', error)
  }
}

export async function listObjects(
  db: Kysely<Database>,
  dataRoot: string,
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

  await requireSpaceStorage(dataRoot, space.id, 'object')
  try {
    let query = db
      .selectFrom('space_objects')
      .selectAll()
      .where('space_id', '=', space.id)
      .where('is_deleted', '=', false)

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

export async function getObjectStorageUsage(
  db: Kysely<Database>,
  actorUserId: string,
  namespaceSlug: string,
  spaceSlug: string,
): Promise<ObjectStorageUsage> {
  const space = await getReadableObjectSpace(
    db,
    actorUserId,
    namespaceSlug,
    spaceSlug,
  )

  try {
    return await readObjectStorageUsage(db, space.id, false)
  } catch (error) {
    if (error instanceof ObjectServiceError) {
      throw error
    }

    throw new ObjectServiceError(
      'INTERNAL',
      500,
      'failed to get object storage usage',
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
  versionId?: string,
): Promise<DownloadedObject> {
  const { object, file } = await openObjectDownload(db, dataRoot, actorUserId, namespaceSlug, spaceSlug, inputKey, versionId)
  return { object, stream: file.createReadStream() }
}

/** Resolve authorization and the immutable version before opening its content. */
export async function openObjectDownload(
  db: Kysely<Database>, dataRoot: string, actorUserId: string | undefined,
  namespaceSlug: string, spaceSlug: string, inputKey: string, versionId?: string,
) {
  const key = validateObjectKey(inputKey)
  const space = await getReadableObjectSpace(
    db,
    actorUserId,
    namespaceSlug,
    spaceSlug,
  )
  const object = await getObjectByKey(db, space.id, key)

  if (!actorUserId && (object.is_deleted || (versionId && versionId !== object.current_version_id))) {
    throw new ObjectServiceError('NOT_FOUND', 404, 'object was not found')
  }
  const version = await db.selectFrom('space_object_versions').selectAll()
    .where('object_id', '=', object.id).where('id', '=', versionId ?? object.current_version_id)
    .where('purge_started_at', 'is', null).executeTakeFirst()
  if (!version || version.is_deleted || !version.storage_key) throw new ObjectServiceError('NOT_FOUND', 404, 'object content was not found')
  try {
    const { file, sizeBytes } = await openObjectFile(dataRoot, space.id, version.storage_key)
    if (sizeBytes !== Number(version.size_bytes)) {
      await file.close()
      throw new ObjectServiceError('OBJECT_CONTENT_CORRUPT', 409, 'Stored object size does not match its metadata.')
    }
    return {
      object: toPublicSpaceObject({ ...object, content_type: version.content_type, size_bytes: version.size_bytes,
        checksum_sha256: version.checksum_sha256, created_by_user_id: version.created_by_user_id,
        updated_at: version.created_at, current_version_id: version.id, revision: version.revision, is_deleted: false }),
      file,
    }
  } catch (error) {
    if (error instanceof ObjectServiceError) throw error
    if (error instanceof ObjectStorageError && error.code === 'NOT_FOUND') {
      throw new ObjectServiceError('OBJECT_CONTENT_MISSING', 404, 'Object metadata exists, but its stored content is missing.', error)
    }
    throwObjectStorageError(error)
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

export function calculateObjectStorageUsage(
  inputUsedBytes: string | number | bigint,
  inputQuotaBytes: string | number | bigint,
): ObjectStorageUsage {
  const usedBytes = toSafeByteNumber(inputUsedBytes)
  const quotaBytes = toSafeByteNumber(inputQuotaBytes)

  return {
    usedBytes,
    quotaBytes,
    remainingBytes: Math.max(quotaBytes - usedBytes, 0),
  }
}

export function ensureObjectQuota(
  usage: ObjectStorageUsage,
  incomingBytes: number,
): void {
  if (incomingBytes > usage.remainingBytes) {
    throw new ObjectServiceError(
      'QUOTA_EXCEEDED',
      413,
      'object space quota exceeded',
    )
  }
}

export function validateObjectKey(input: string): string {
  try {
    return normalizeObjectKey(input)
  } catch (error) {
    throwObjectStorageError(error)
  }
}

export function validateObjectPrefix(input?: string): string {
  try {
    return normalizeObjectPrefix(input)
  } catch (error) {
    throwObjectStorageError(error)
  }
}

export function normalizeContentType(input?: string): string {
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

export function throwObjectStorageError(error: unknown): never {
  if (error instanceof SpaceStorageUnavailable) throw error
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

export function toPublicSpaceObject(object: SpaceObject): PublicSpaceObject {
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
    versionId: object.current_version_id,
    revision: object.revision,
    isDeleted: object.is_deleted,
  }
}

export async function getObjectByKey(
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

export async function readObjectStorageUsage(
  db: Kysely<Database>,
  spaceId: string,
  lockSpace: boolean,
): Promise<ObjectStorageUsage> {
  let spaceQuery = db
    .selectFrom('spaces')
    .select('quota_bytes')
    .where('id', '=', spaceId)

  if (lockSpace) {
    spaceQuery = spaceQuery.forUpdate()
  }

  const space = await spaceQuery.executeTakeFirst()

  if (!space) {
    throw new ObjectServiceError('NOT_FOUND', 404, 'space not found')
  }

  const total = await db
    .selectFrom('space_object_versions')
    .select(({ fn }) => fn.sum<string>('size_bytes').as('used_bytes'))
    .where('space_id', '=', spaceId)
    .executeTakeFirstOrThrow()

  return calculateObjectStorageUsage(
    total.used_bytes ?? 0,
    space.quota_bytes,
  )
}

function toSafeByteNumber(input: string | number | bigint): number {
  let value: bigint

  try {
    value = BigInt(input)
  } catch (error) {
    throw new ObjectServiceError(
      'INTERNAL',
      500,
      'invalid object storage usage value',
      error,
    )
  }

  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ObjectServiceError(
      'INTERNAL',
      500,
      'object storage usage exceeds the supported range',
    )
  }

  return Number(value)
}

export function escapeLikePrefix(input: string): string {
  return input.replace(/[\\%_]/g, '\\$&')
}
