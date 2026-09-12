import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AppConfig } from '../../config.js'
import { getSpaceStoragePath, resolveDataRoot } from '../space/storage.js'
import { freeDiskBytes, measureGitObjects } from './receive-hook.js'

export type GitResourceLimits = Pick<AppConfig, 'GIT_MAX_PUSH_BYTES' | 'GIT_REPOSITORY_MAX_BYTES' | 'STORAGE_MIN_FREE_BYTES'>
export const defaultGitLimits: GitResourceLimits = {
  GIT_MAX_PUSH_BYTES: 100 * 1024 * 1024,
  GIT_REPOSITORY_MAX_BYTES: 1024 * 1024 * 1024,
  STORAGE_MIN_FREE_BYTES: 1024 * 1024 * 1024,
}

export class GitResourceError extends Error {
  constructor(readonly code: string, readonly statusCode: number, message: string) { super(message) }
}

const pushing = new Set<string>()
const reservations = new Map<string, number>()

export async function acquireGitPush(dataRoot: string, spaceId: string, limits: GitResourceLimits) {
  const root = resolveDataRoot(dataRoot)
  const repository = getSpaceStoragePath(root, spaceId)
  if (pushing.has(repository)) throw new GitResourceError('GIT_PUSH_BUSY', 409, 'A push is already running for this repository. Please retry shortly.')
  pushing.add(repository)
  // Reserve headroom across admitted pushes. Git thin packs and indexes can
  // grow on disk, so admission is conservative; the hook checks again.
  const reservation = 2 * limits.GIT_MAX_PUSH_BYTES + 1024 * 1024
  reservations.set(root, (reservations.get(root) ?? 0) + reservation)
  let released = false
  const release = () => {
    if (released) return
    released = true
    pushing.delete(repository)
    const remaining = (reservations.get(root) ?? 0) - reservation
    if (remaining) reservations.set(root, remaining)
    else reservations.delete(root)
  }
  try {
    if (await freeDiskBytes(root) < limits.STORAGE_MIN_FREE_BYTES + (reservations.get(root) ?? 0)) {
      throw new GitResourceError('STORAGE_LOW_SPACE', 507, 'Storage is low on free space. Please try again later.')
    }
    if (await measureGitObjects(join(repository, 'objects'), limits.GIT_REPOSITORY_MAX_BYTES) > limits.GIT_REPOSITORY_MAX_BYTES) {
      throw new GitResourceError('GIT_REPOSITORY_FULL', 507, 'Repository storage limit exceeded. Contact the administrator.')
    }
    return release
  } catch (error) { release(); throw error }
}

export async function createReceiveHook(repository: string) {
  const directory = await mkdtemp(join(repository, '.ensp-hooks-'))
  try {
    const sourceExtension = import.meta.url.endsWith('.ts') ? '.ts' : '.js'
    const script = fileURLToPath(new URL('./receive-hook' + sourceExtension, import.meta.url))
    const quote = (value: string) => "'" + value.replaceAll('\\', '/').replaceAll("'", "'\\''") + "'"
    const hook = join(directory, 'pre-receive')
    await writeFile(hook, '#!/bin/sh\nexec ' + quote(process.execPath) + ' ' + quote(script) + '\n', { mode: 0o700 })
    await chmod(hook, 0o700)
    return { directory, dispose: () => rm(directory, { recursive: true, force: true }) }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}
