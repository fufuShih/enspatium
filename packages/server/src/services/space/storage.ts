import { access, lstat, mkdir, opendir, realpath, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { SpaceType } from '../../db/types/space.types.js'
import { execGit, GitCapacityError } from '../git/process.js'

const repositoryRoot = fileURLToPath(new URL('../../../../../', import.meta.url))
const spaceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class SpaceStorageUnavailable extends Error {
  readonly code = 'SPACE_STORAGE_UNAVAILABLE'
  readonly statusCode = 503
  constructor(cause?: unknown) {
    super('Space storage is unavailable. Restore storage access and try again.', { cause })
  }
}

// Detect a missing/replaced mount during this process without recreating it.
const storageRoots = new Map<string, string>()

export async function requireStorageRoot(dataRoot: string, writable = false): Promise<string> {
  const root = resolveDataRoot(dataRoot)
  try {
    const info = await lstat(root)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('invalid storage root')
    const identity = `${await realpath(root)}:${info.dev}:${info.ino}`
    const previous = storageRoots.get(root)
    if (previous && previous !== identity) throw new Error('storage root changed')
    await access(root, constants.R_OK | constants.X_OK | (writable ? constants.W_OK : 0))
    const directory = await opendir(root)
    await directory.close()
    storageRoots.set(root, identity)
    return root
  } catch (error) { throw new SpaceStorageUnavailable(error) }
}

export async function requireSpaceStorage(dataRoot: string, spaceId: string, type: SpaceType, writable = false): Promise<string> {
  const target = getSpaceStoragePath(dataRoot, spaceId)
  await requireStorageRoot(dataRoot, writable)
  try {
    const info = await lstat(target)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('invalid Space directory')
    await access(target, constants.R_OK | constants.X_OK | (writable ? constants.W_OK : 0))
    const directory = await opendir(target)
    await directory.close()
    if (type === 'git') {
      for (const name of ['HEAD', 'objects', 'refs']) {
        const entry = await lstat(resolve(target, name))
        if (entry.isSymbolicLink() || (name === 'HEAD' ? !entry.isFile() : !entry.isDirectory())) throw new Error('invalid Git storage')
      }
      const result = await execGit(['--git-dir', target, 'rev-parse', '--is-bare-repository'], { timeout: 10_000, windowsHide: true })
      if (result.stdout.trim() !== 'true') throw new Error('invalid bare repository')
    }
    return target
  } catch (error) {
    if (error instanceof GitCapacityError) throw error
    throw new SpaceStorageUnavailable(error)
  }
}

export function resolveDataRoot(configuredRoot: string): string {
  return isAbsolute(configuredRoot)
    ? resolve(configuredRoot)
    : resolve(repositoryRoot, configuredRoot)
}

export async function initializeStorage(dataRoot: string): Promise<void> {
  const root = resolveDataRoot(dataRoot)

  if (!storageRoots.has(root)) await mkdir(root, { recursive: true })
  await requireStorageRoot(root, true)
}

export function getSpaceStoragePath(
  dataRoot: string,
  spaceId: string,
): string {
  if (!spaceIdPattern.test(spaceId)) {
    throw new Error('invalid space id')
  }

  const root = resolveDataRoot(dataRoot)
  const target = resolve(root, spaceId)
  const pathFromRoot = relative(root, target)

  if (
    !pathFromRoot ||
    pathFromRoot === '..' ||
    pathFromRoot.startsWith('..' + sep) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new Error('space storage path is outside DATA_ROOT')
  }

  return target
}

export async function createSpaceStorage(
  dataRoot: string,
  spaceId: string,
  spaceType: SpaceType,
): Promise<void> {
  await initializeStorage(dataRoot)

  const target = getSpaceStoragePath(dataRoot, spaceId)

  if (spaceType === 'git') {
    await execGit(['init', '--bare', '--initial-branch=main', target], {
      timeout: 10_000,
      windowsHide: true,
    })
    return
  }

  await mkdir(target, { recursive: true })
}

export async function deleteSpaceStorage(
  dataRoot: string,
  spaceId: string,
): Promise<void> {
  const target = getSpaceStoragePath(dataRoot, spaceId)

  await requireStorageRoot(dataRoot, true)
  try {
    const info = await lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (!info) return
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('invalid Space directory')
    await rm(target, { recursive: true, force: true })
  } catch (error) { throw new SpaceStorageUnavailable(error) }
}
