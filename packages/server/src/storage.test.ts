import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createSpaceStorage,
  deleteSpaceStorage,
  getGitRepositoryInfo,
  getSpaceStoragePath,
  initializeStorage,
} from './storage.js'

const execFileAsync = promisify(execFile)
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

describe('local storage', () => {
  it('initializes the storage directories', async () => {
    const root = await createTemporaryRoot()

    await initializeStorage(root)

    expect((await stat(join(root, 'git'))).isDirectory()).toBe(true)
    expect((await stat(join(root, 'objects'))).isDirectory()).toBe(true)
    expect((await stat(join(root, 'temp'))).isDirectory()).toBe(true)
  })

  it('creates and removes an object space directory', async () => {
    const root = await createTemporaryRoot()
    const target = getSpaceStoragePath(root, spaceId, 'object')

    await createSpaceStorage(root, spaceId, 'object')
    await createSpaceStorage(root, spaceId, 'object')

    expect((await stat(target)).isDirectory()).toBe(true)

    await deleteSpaceStorage(root, spaceId, 'object')
    await deleteSpaceStorage(root, spaceId, 'object')

    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('creates a bare Git repository', async () => {
    const root = await createTemporaryRoot()
    const target = getSpaceStoragePath(root, spaceId, 'git')

    await createSpaceStorage(root, spaceId, 'git')

    await expect(readFile(join(target, 'HEAD'), 'utf8')).resolves.toMatch(
      /^ref: refs\/heads\//,
    )

    const info = await getGitRepositoryInfo(root, spaceId)

    expect(info.defaultBranch).not.toBe('')
    expect(info.branches).toEqual([])
    expect(info.commits).toEqual([])
  })

  it('reads branches and recent commits from a Git repository', async () => {
    const root = await createTemporaryRoot()
    const repositoryPath = getSpaceStoragePath(root, spaceId, 'git')
    const worktreePath = join(root, 'worktree')

    await createSpaceStorage(root, spaceId, 'git')
    await execFileAsync('git', ['clone', repositoryPath, worktreePath])
    await execFileAsync('git', [
      '-C',
      worktreePath,
      'config',
      'user.name',
      'Test User',
    ])
    await execFileAsync('git', [
      '-C',
      worktreePath,
      'config',
      'user.email',
      'test@example.com',
    ])
    await writeFile(join(worktreePath, 'README.md'), '# Test\n', 'utf8')
    await execFileAsync('git', ['-C', worktreePath, 'add', 'README.md'])
    await execFileAsync('git', [
      '-C',
      worktreePath,
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'Initial commit',
    ])
    await execFileAsync('git', [
      '-C',
      worktreePath,
      'push',
      'origin',
      'HEAD:main',
    ])
    await execFileAsync('git', [
      `--git-dir=${repositoryPath}`,
      'symbolic-ref',
      'HEAD',
      'refs/heads/main',
    ])

    const info = await getGitRepositoryInfo(root, spaceId)

    expect(info.defaultBranch).toBe('main')
    expect(info.branches).toEqual(['main'])
    expect(info.commits).toHaveLength(1)
    expect(info.commits[0]).toMatchObject({
      authorName: 'Test User',
      authorEmail: 'test@example.com',
      message: 'Initial commit',
    })
    expect(info.commits[0]?.id).toMatch(/^[0-9a-f]{40}$/)
    expect(info.commits[0]?.authoredAt).not.toBe('')
  })

  it('rejects an invalid space id', async () => {
    const root = await createTemporaryRoot()

    expect(() => getSpaceStoragePath(root, '../outside', 'object')).toThrow(
      'invalid space id',
    )
  })
})
