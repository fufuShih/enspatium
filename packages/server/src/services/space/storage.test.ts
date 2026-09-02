import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createSpaceStorage,
  deleteSpaceStorage,
  getSpaceStoragePath,
  initializeStorage,
} from './storage.js'

const spaceId = '00000000-0000-4000-8000-000000000001'
const temporaryRoots: string[] = []

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'enspatium-storage-'))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, {
        recursive: true,
        force: true,
      }),
    ),
  )
})

describe('Space storage', () => {
  it('initializes only the data root', async () => {
    const temporaryRoot = await createTemporaryRoot()
    const root = join(temporaryRoot, 'data')

    await initializeStorage(root)

    expect((await stat(root)).isDirectory()).toBe(true)
    await expect(readdir(root)).resolves.toEqual([])
  })

  it('creates and removes an object space directory', async () => {
    const root = await createTemporaryRoot()
    const target = getSpaceStoragePath(root, spaceId)

    expect(target).toBe(join(root, spaceId))

    await createSpaceStorage(root, spaceId, 'object')
    await createSpaceStorage(root, spaceId, 'object')

    expect((await stat(target)).isDirectory()).toBe(true)

    await deleteSpaceStorage(root, spaceId)
    await deleteSpaceStorage(root, spaceId)

    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('creates a bare Git repository', async () => {
    const root = await createTemporaryRoot()
    const target = getSpaceStoragePath(root, spaceId)

    await createSpaceStorage(root, spaceId, 'git')

    await expect(readFile(join(target, 'HEAD'), 'utf8')).resolves.toMatch(
      /^ref: refs\/heads\//,
    )
  })

  it('rejects an invalid space id', async () => {
    const root = await createTemporaryRoot()

    expect(() => getSpaceStoragePath(root, '../outside')).toThrow(
      'invalid space id',
    )
  })
})
