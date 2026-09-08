import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { link, lstat, mkdir, open, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { Transform, type Readable, type TransformCallback } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { getSpaceStoragePath, requireSpaceStorage, SpaceStorageUnavailable } from '../space/storage.js'

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

  const target = await prepareObjectPath(dataRoot, spaceId, key, true, true)
  const parent = dirname(target)
  const temporaryPath = resolve(
    parent,
    `.${basename(target)}.${randomUUID()}.upload`,
  )
  const hash = createHash('sha256')
  let sizeBytes = 0

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

    throw new SpaceStorageUnavailable(error)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

export async function deleteObjectFile(
  dataRoot: string,
  spaceId: string,
  key: string,
): Promise<void> {
  const target = await prepareObjectPath(dataRoot, spaceId, key, true)

  await rm(target, { force: true }).catch(error => { throw new SpaceStorageUnavailable(error) })
}

export async function readObjectFile(
  dataRoot: string,
  spaceId: string,
  key: string,
): Promise<Readable> {
  const target = await prepareObjectPath(dataRoot, spaceId, key)

  try {
    const handle = await open(target, 'r')
    const fileStat = await handle.stat().catch(async error => { await handle.close(); throw error })
    if (!fileStat.isFile()) {
      await handle.close()
      throw new ObjectStorageError(
        'NOT_FOUND',
        'object file was not found',
      )
    }

    return handle.createReadStream()
  } catch (error) {
    if (error instanceof ObjectStorageError) {
      throw error
    }

    if (isFileNotFoundError(error)) {
      await requireSpaceStorage(dataRoot, spaceId, 'object')
      throw new ObjectStorageError(
        'NOT_FOUND',
        'object file was not found',
        error,
      )
    }

    throw new SpaceStorageUnavailable(error)
  }
}

async function prepareObjectPath(dataRoot: string, spaceId: string, key: string, writable = false, createParents = false) {
  const target = getObjectStoragePath(dataRoot, spaceId, key)
  let parent = await requireSpaceStorage(dataRoot, spaceId, 'object', writable)
  const parts = normalizeObjectKey(key).split('/')
  for (let index = 0; index < parts.length; index++) {
    parent = resolve(parent, parts[index]!)
    const isParent = index < parts.length - 1
    if (isParent && createParents) {
      // Never recursively recreate a missing Space root during an upload.
      await mkdir(parent).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw new SpaceStorageUnavailable(error) })
    }
    const info = await lstat(parent).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw new SpaceStorageUnavailable(error)
    })
    if (!info) break
    if (info.isSymbolicLink() || (isParent && !info.isDirectory())) throw new SpaceStorageUnavailable()
  }
  return target
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
