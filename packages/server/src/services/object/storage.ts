import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { link, mkdir, rm, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { Transform, type Readable, type TransformCallback } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { getSpaceStoragePath } from '../space/storage.js'

export const maximumObjectSizeBytes = 100 * 1024 * 1024

export type ObjectStorageErrorCode =
  | 'INVALID_KEY'
  | 'TOO_LARGE'
  | 'ALREADY_EXISTS'
  | 'NOT_FOUND'
  | 'INTERNAL'

export class ObjectStorageError extends Error {
  constructor(
    readonly code: ObjectStorageErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause })
    this.name = 'ObjectStorageError'
  }
}

export interface StoredObjectFile {
  sizeBytes: number
  checksumSha256: string
}

export function normalizeObjectKey(input: string): string {
  if (!input || input.length > 1024 || input.startsWith('/')) {
    throw invalidObjectKey()
  }

  const segments = input.split('/')

  if (segments.some(isInvalidObjectKeySegment)) {
    throw invalidObjectKey()
  }

  return segments.join('/')
}

export function normalizeObjectPrefix(input?: string): string {
  if (input === undefined || input === '') {
    return ''
  }

  if (
    input.length > 1024 ||
    input.startsWith('/') ||
    /[\u0000-\u001f<>:"\\|?*]/.test(input)
  ) {
    throw invalidObjectKey()
  }

  const segments = input.split('/')
  const lastIndex = segments.length - 1

  if (
    segments.some(
      (segment, index) =>
        segment === '.' ||
        segment === '..' ||
        (!segment && index !== lastIndex),
    )
  ) {
    throw invalidObjectKey()
  }

  return input
}

export function getObjectStoragePath(
  dataRoot: string,
  spaceId: string,
  inputKey: string,
): string {
  const key = normalizeObjectKey(inputKey)
  const spaceRoot = getSpaceStoragePath(dataRoot, spaceId)
  const target = resolve(spaceRoot, ...key.split('/'))
  const pathFromSpace = relative(spaceRoot, target)

  if (
    !pathFromSpace ||
    pathFromSpace === '..' ||
    pathFromSpace.startsWith('..' + sep) ||
    isAbsolute(pathFromSpace)
  ) {
    throw invalidObjectKey()
  }

  return target
}

export async function writeObjectFile(
  dataRoot: string,
  spaceId: string,
  key: string,
  source: Readable,
  declaredSize?: number,
): Promise<StoredObjectFile> {
  if (declaredSize !== undefined && declaredSize > maximumObjectSizeBytes) {
    throw new ObjectStorageError(
      'TOO_LARGE',
      `object may not exceed ${maximumObjectSizeBytes} bytes`,
    )
  }

  const target = getObjectStoragePath(dataRoot, spaceId, key)
  const parent = dirname(target)
  const temporaryPath = resolve(
    parent,
    `.${basename(target)}.${randomUUID()}.upload`,
  )
  const hash = createHash('sha256')
  let sizeBytes = 0

  await mkdir(parent, { recursive: true })

  const meter = new Transform({
    transform(
      chunk: Buffer | string,
      encoding: BufferEncoding,
      callback: TransformCallback,
    ) {
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk, encoding)

      sizeBytes += buffer.length

      if (sizeBytes > maximumObjectSizeBytes) {
        callback(
          new ObjectStorageError(
            'TOO_LARGE',
            `object may not exceed ${maximumObjectSizeBytes} bytes`,
          ),
        )
        return
      }

      hash.update(buffer)
      callback(null, buffer)
    },
  })

  try {
    await pipeline(
      source,
      meter,
      createWriteStream(temporaryPath, { flags: 'wx' }),
    )

    try {
      await link(temporaryPath, target)
    } catch (error) {
      if (isFileExistsError(error)) {
        throw new ObjectStorageError(
          'ALREADY_EXISTS',
          'object key already exists',
          error,
        )
      }

      throw error
    }

    return {
      sizeBytes,
      checksumSha256: hash.digest('hex'),
    }
  } catch (error) {
    if (error instanceof ObjectStorageError) {
      throw error
    }

    throw new ObjectStorageError(
      'INTERNAL',
      'failed to write object file',
      error,
    )
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

export async function deleteObjectFile(
  dataRoot: string,
  spaceId: string,
  key: string,
): Promise<void> {
  const target = getObjectStoragePath(dataRoot, spaceId, key)

  await rm(target, { force: true })
}

export async function readObjectFile(
  dataRoot: string,
  spaceId: string,
  key: string,
): Promise<Readable> {
  const target = getObjectStoragePath(dataRoot, spaceId, key)

  try {
    const fileStat = await stat(target)

    if (!fileStat.isFile()) {
      throw new ObjectStorageError(
        'NOT_FOUND',
        'object file was not found',
      )
    }

    return createReadStream(target)
  } catch (error) {
    if (error instanceof ObjectStorageError) {
      throw error
    }

    if (isFileNotFoundError(error)) {
      throw new ObjectStorageError(
        'NOT_FOUND',
        'object file was not found',
        error,
      )
    }

    throw new ObjectStorageError(
      'INTERNAL',
      'failed to open object file',
      error,
    )
  }
}

function isInvalidObjectKeySegment(segment: string): boolean {
  return (
    !segment ||
    segment === '.' ||
    segment === '..' ||
    /[\u0000-\u001f<>:"\\|?*]/.test(segment) ||
    /[. ]$/.test(segment) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)
  )
}

function invalidObjectKey(): ObjectStorageError {
  return new ObjectStorageError('INVALID_KEY', 'invalid object key')
}

function isFileExistsError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'EEXIST'
  )
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}
