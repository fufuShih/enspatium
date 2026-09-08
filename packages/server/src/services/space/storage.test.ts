import { mkdir, mkdtemp, readdir, readFile, rename, rm, rmdir, stat, symlink, writeFile } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, access: vi.fn(actual.access) }
})

import {
  createSpaceStorage,
  deleteSpaceStorage,
  getSpaceStoragePath,
  initializeStorage,
  requireSpaceStorage,
} from './storage.js'

const spaceId = '00000000-0000-4000-8000-000000000001'
const temporaryRoots: string[] = []

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'enspatium-storage-'))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  vi.restoreAllMocks()
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
  it('blocks deletion and initialization when the root goes missing or is replaced, then recovers', async () => {
    const parent = await createTemporaryRoot()
    const root = join(parent, 'data')
    const backup = join(parent, 'backup')
    await createSpaceStorage(root, spaceId, 'object')
    await rename(root, backup)
    await expect(deleteSpaceStorage(root, spaceId)).rejects.toMatchObject({ code: 'SPACE_STORAGE_UNAVAILABLE' })
    await expect(initializeStorage(root)).rejects.toMatchObject({ code: 'SPACE_STORAGE_UNAVAILABLE' })
    await expect(stat(root)).rejects.toMatchObject({ code: 'ENOENT' })
    await mkdir(root)
    await expect(deleteSpaceStorage(root, spaceId)).rejects.toMatchObject({ code: 'SPACE_STORAGE_UNAVAILABLE' })
    await rmdir(root)
    await rename(backup, root)
    await expect(requireSpaceStorage(root, spaceId, 'object')).resolves.toBe(join(root, spaceId))
  })

  it('does not swallow root permission errors during deletion', async () => {
    const root = await createTemporaryRoot()
    await createSpaceStorage(root, spaceId, 'object')
    vi.mocked(fs.access).mockRejectedValueOnce(Object.assign(new Error('access denied'), { code: 'EACCES' }))
    await expect(deleteSpaceStorage(root, spaceId)).rejects.toMatchObject({ code: 'SPACE_STORAGE_UNAVAILABLE' })
    expect((await stat(join(root, spaceId))).isDirectory()).toBe(true)
  })

  it('refuses a Space directory link and preserves its destination', async () => {
    const root = await createTemporaryRoot()
    await initializeStorage(root)
    const outside = join(root, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'keep.txt'), 'keep')
    await symlink(outside, join(root, spaceId), 'junction')
    await expect(deleteSpaceStorage(root, spaceId)).rejects.toMatchObject({ code: 'SPACE_STORAGE_UNAVAILABLE' })
    expect(await readFile(join(outside, 'keep.txt'), 'utf8')).toBe('keep')
  })
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
