import { execFile } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import type { SpaceType } from './db/space.types.js'

const execFileAsync = promisify(execFile)
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const spaceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function resolveDataRoot(configuredRoot: string): string {
  return isAbsolute(configuredRoot)
    ? resolve(configuredRoot)
    : resolve(repositoryRoot, configuredRoot)
}

export async function initializeStorage(dataRoot: string): Promise<void> {
  const root = resolveDataRoot(dataRoot)

  await Promise.all([
    mkdir(resolve(root, 'git'), { recursive: true }),
    mkdir(resolve(root, 'objects'), { recursive: true }),
    mkdir(resolve(root, 'temp'), { recursive: true }),
  ])
}

export function getSpaceStoragePath(
  dataRoot: string,
  spaceId: string,
  spaceType: SpaceType,
): string {
  if (!spaceIdPattern.test(spaceId)) {
    throw new Error('invalid space id')
  }

  const root = resolveDataRoot(dataRoot)
  const relativePath =
    spaceType === 'git' ? 'git/' + spaceId + '.git' : 'objects/' + spaceId
  const target = resolve(root, relativePath)
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

  const target = getSpaceStoragePath(dataRoot, spaceId, spaceType)

  if (spaceType === 'git') {
    await execFileAsync('git', ['init', '--bare', target], {
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
  spaceType: SpaceType,
): Promise<void> {
  const target = getSpaceStoragePath(dataRoot, spaceId, spaceType)

  await rm(target, {
    recursive: true,
    force: true,
  })
}
