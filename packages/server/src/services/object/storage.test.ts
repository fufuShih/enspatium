import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, rename, stat, symlink, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { createSpaceStorage } from '../space/storage.js'

import {
  deleteObjectFile,
  getObjectStoragePath,
  maximumObjectSizeBytes,
  normalizeObjectKey,
  normalizeObjectPrefix,
  ObjectStorageError,
  readObjectFile,
  writeObjectFile,
} from './storage.js'

const spaceId = '00000000-0000-4000-8000-000000000001'
const temporaryRoots: string[] = []

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'enspatium-object-'))
  temporaryRoots.push(root)
  await createSpaceStorage(root, spaceId, 'object')
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

describe('Object storage', () => {
  it('does not recreate a missing Space on upload and works after restoration', async () => {
    const root = await createTemporaryRoot()
    const target = join(root, spaceId)
    const backup = join(root, 'backup')
    await rename(target, backup)
    await expect(writeObjectFile(root, spaceId, 'nested/file.txt', Readable.from(['content']))).rejects.toMatchObject({ code: 'SPACE_STORAGE_UNAVAILABLE', statusCode: 503 })
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readObjectFile(root, spaceId, 'file.txt')).rejects.toMatchObject({ code: 'SPACE_STORAGE_UNAVAILABLE' })
    await rename(backup, target)
    await expect(writeObjectFile(root, spaceId, 'nested/file.txt', Readable.from(['content']))).resolves.toMatchObject({ sizeBytes: 7 })
  })

  it('rejects nested directory links rather than writing outside the Space', async () => {
    const root = await createTemporaryRoot()
    const outside = join(root, 'outside')
    await mkdir(outside)
    await symlink(outside, join(root, spaceId, 'linked'), 'junction')
    await expect(writeObjectFile(root, spaceId, 'linked/file.txt', Readable.from(['content']))).rejects.toMatchObject({ code: 'SPACE_STORAGE_UNAVAILABLE' })
    await expect(stat(join(outside, 'file.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('resolves a nested key inside its Space directory', async () => {
    const root = await createTemporaryRoot()

    expect(normalizeObjectKey('images/avatar.png')).toBe('images/avatar.png')
    expect(getObjectStoragePath(root, spaceId, 'images/avatar.png')).toBe(
      join(root, spaceId, 'images', 'avatar.png'),
    )
  })

  it.each([
    '',
    '/outside',
    '../outside',
    'folder/../outside',
    'folder//file',
    'folder\\file',
    'file:stream',
    'CON/file',
    'file.',
  ])('rejects an unsafe key: %s', (key) => {
    expect(() => normalizeObjectKey(key)).toThrow(ObjectStorageError)
  })

  it('accepts a safe partial prefix', () => {
    expect(normalizeObjectPrefix()).toBe('')
    expect(normalizeObjectPrefix('images/')).toBe('images/')
    expect(normalizeObjectPrefix('images/ava')).toBe('images/ava')
  })

  it.each(['/outside', '../outside', 'folder//file', 'folder\\file'])(
    'rejects an unsafe prefix: %s',
    (prefix) => {
      expect(() => normalizeObjectPrefix(prefix)).toThrow(ObjectStorageError)
    },
  )

  it('streams a file and calculates its checksum', async () => {
    const root = await createTemporaryRoot()
    const content = Buffer.from('hello object storage')

    const stored = await writeObjectFile(
      root,
      spaceId,
      'documents/hello.txt',
      Readable.from([content]),
      content.length,
    )

    expect(stored).toEqual({
      sizeBytes: content.length,
      checksumSha256: createHash('sha256').update(content).digest('hex'),
    })
    await expect(
      readFile(getObjectStoragePath(root, spaceId, 'documents/hello.txt')),
    ).resolves.toEqual(content)
  })

  it('does not overwrite an existing object', async () => {
    const root = await createTemporaryRoot()

    await writeObjectFile(
      root,
      spaceId,
      'file.txt',
      Readable.from(['first']),
    )

    await expect(
      writeObjectFile(
        root,
        spaceId,
        'file.txt',
        Readable.from(['second']),
      ),
    ).rejects.toMatchObject({ code: 'ALREADY_EXISTS' })

    await expect(
      readFile(getObjectStoragePath(root, spaceId, 'file.txt'), 'utf8'),
    ).resolves.toBe('first')
  })

  it('opens and deletes a stored object', async () => {
    const root = await createTemporaryRoot()

    await writeObjectFile(
      root,
      spaceId,
      'file.txt',
      Readable.from(['content']),
    )

    const stream = await readObjectFile(root, spaceId, 'file.txt')
    const chunks: Buffer[] = []

    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk))
    }

    expect(Buffer.concat(chunks).toString('utf8')).toBe('content')

    await deleteObjectFile(root, spaceId, 'file.txt')
    await expect(
      readObjectFile(root, spaceId, 'file.txt'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('rejects a declared size above the upload limit', async () => {
    const root = await createTemporaryRoot()

    await expect(
      writeObjectFile(
        root,
        spaceId,
        'large.bin',
        Readable.from([]),
        maximumObjectSizeBytes + 1,
      ),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' })
  })
})
