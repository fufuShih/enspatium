import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

import { createSpaceStorage, getSpaceStoragePath } from '../space/storage.js'
import {
  getGitCommit,
  getGitCommits,
  getGitDiff,
  getGitFile,
  getGitReadme,
  getGitRepositoryInfo,
  getGitTags,
  getGitTree,
  synchronizeGitHead,
} from './repository.js'

const execFileAsync = promisify(execFile)
const spaceId = '00000000-0000-4000-8000-000000000001'
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('Git repository', () => {
  it('distinguishes missing or invalid repository storage from a valid empty repository', async () => {
    const root = await createTemporaryRoot()
    await createSpaceStorage(root, spaceId, 'git')
    const target = getSpaceStoragePath(root, spaceId)
    await rm(join(target, 'HEAD'))
    await expect(getGitRepositoryInfo(root, spaceId)).rejects.toMatchObject({ code: 'SPACE_STORAGE_UNAVAILABLE' })
    await expect(getGitTree(root, spaceId)).rejects.toMatchObject({ code: 'SPACE_STORAGE_UNAVAILABLE' })
  })
  it('reads an empty repository', async () => {
    const root = await createTemporaryRoot()

    await createSpaceStorage(root, spaceId, 'git')

    await synchronizeGitHead(root, spaceId)
    const info = await getGitRepositoryInfo(root, spaceId)

    expect(info.defaultBranch).toBe('main')
    expect(info.branches).toEqual([])
    expect(info.commits).toEqual([])
    await expect(getGitTags(root, spaceId)).resolves.toEqual([])
  })

  it('reads branches, commits, trees and files', async () => {
    const root = await createTemporaryRoot()
    const repositoryPath = getSpaceStoragePath(root, spaceId)
    const worktreePath = join(root, 'worktree')

    await createSpaceStorage(root, spaceId, 'git')
    await execFileAsync('git', ['clone', repositoryPath, worktreePath])
    await configureTestAuthor(worktreePath)
    await writeFile(join(worktreePath, 'README.md'), '# Test\n', 'utf8')
    await mkdir(join(worktreePath, 'src'))
    await writeFile(
      join(worktreePath, 'src', 'index.ts'),
      "export const value = 'test'\n",
      'utf8',
    )
    await execFileAsync('git', ['-C', worktreePath, 'add', '.'])
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
      'tag',
      '-a',
      'v1.0.0',
      '-m',
      'Version 1.0.0',
    ])
    await execFileAsync('git', [
      '-C',
      worktreePath,
      'push',
      'origin',
      'HEAD:main',
      '--tags',
    ])
    await execFileAsync('git', [
      '--git-dir=' + repositoryPath,
      'symbolic-ref',
      'HEAD',
      'refs/heads/missing-legacy-default',
    ])
    await synchronizeGitHead(root, spaceId)

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

    const initialCommitId = info.commits[0]?.id

    if (!initialCommitId) {
      throw new Error('test repository has no initial commit')
    }

    await expect(getGitTags(root, spaceId)).resolves.toEqual([
      {
        name: 'v1.0.0',
        commitId: initialCommitId,
      },
    ])

    const initialDiff = await getGitDiff(root, spaceId, undefined, initialCommitId)
    expect(initialDiff.from).toBeNull()
    expect(initialDiff.patch).toContain('+# Test')
    expect(initialDiff.patch).toContain('new file mode')

    await expect(getGitCommit(root, spaceId, 'v1.0.0')).resolves.toMatchObject({
      ref: 'v1.0.0',
      id: initialCommitId,
      parentIds: [],
      authorName: 'Test User',
      authorEmail: 'test@example.com',
      committerName: 'Test User',
      committerEmail: 'test@example.com',
      message: 'Initial commit',
    })

    const rootTree = await getGitTree(root, spaceId, 'main')

    expect(rootTree.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'README.md',
          path: 'README.md',
          type: 'file',
        }),
        expect.objectContaining({
          name: 'src',
          path: 'src',
          type: 'directory',
        }),
      ]),
    )

    const sourceTree = await getGitTree(root, spaceId, 'main', 'src')

    expect(sourceTree.entries).toEqual([
      expect.objectContaining({
        name: 'index.ts',
        path: 'src/index.ts',
        type: 'file',
      }),
    ])

    const file = await getGitFile(root, spaceId, 'main', 'src/index.ts')

    expect(file).toMatchObject({
      ref: 'main',
      path: 'src/index.ts',
      name: 'index.ts',
      encoding: 'utf-8',
      content: "export const value = 'test'\n",
    })

    const readme = await getGitReadme(root, spaceId, 'main')

    expect(readme).toMatchObject({
      ref: 'main',
      path: 'README.md',
      encoding: 'utf-8',
      content: '# Test\n',
    })

    await expect(
      getGitFile(root, spaceId, 'main', '../README.md'),
    ).rejects.toMatchObject({ code: 'INVALID_PATH' })

    await writeFile(
      join(worktreePath, 'src', 'index.ts'),
      "export const value = 'updated'\n",
      'utf8',
    )
    await execFileAsync('git', ['-C', worktreePath, 'add', '.'])
    await execFileAsync('git', [
      '-C',
      worktreePath,
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'Update value',
    ])
    await execFileAsync('git', [
      '-C',
      worktreePath,
      'push',
      'origin',
      'HEAD:main',
    ])

    const updatedCommit = await getGitCommit(root, spaceId, 'main')

    expect(updatedCommit).toMatchObject({
      ref: 'main',
      parentIds: [initialCommitId],
      message: 'Update value',
    })

    const diff = await getGitDiff(root, spaceId, initialCommitId, 'main')

    expect(diff.from).toEqual({
      ref: initialCommitId,
      commitId: initialCommitId,
    })
    expect(diff.to).toEqual({
      ref: 'main',
      commitId: updatedCommit.id,
    })
    expect(diff.patch).toContain('diff --git a/src/index.ts b/src/index.ts')
    expect(diff.patch).toContain("-export const value = 'test'")
    expect(diff.patch).toContain("+export const value = 'updated'")

    expect((await getGitDiff(root, spaceId, undefined, updatedCommit.id)).patch).toBe(diff.patch)
    const firstPage = await getGitCommits(root, spaceId, 'refs/heads/main', 0, 1)
    expect(firstPage).toMatchObject({ commitId: updatedCommit.id, hasMore: true, commits: [{ id: updatedCommit.id }] })
    const secondPage = await getGitCommits(root, spaceId, firstPage.commitId, 1, 1)
    expect(secondPage).toMatchObject({ hasMore: false, commits: [{ id: initialCommitId }] })
    expect((await getGitCommits(root, spaceId, 'v1.0.0')).commits.map(commit => commit.id)).toEqual([initialCommitId])
    await expect(getGitCommits(root, spaceId, '--all')).rejects.toMatchObject({ code: 'REF_NOT_FOUND' })

    await writeFile(
      join(worktreePath, 'large.txt'),
      'x'.repeat(1024 * 1024 + 1024) + '\n',
      'utf8',
    )
    await execFileAsync('git', ['-C', worktreePath, 'add', '.'])
    await execFileAsync('git', [
      '-C',
      worktreePath,
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'Add large diff',
    ])
    await execFileAsync('git', [
      '-C',
      worktreePath,
      'push',
      'origin',
      'HEAD:main',
    ])

    await expect(
      getGitDiff(root, spaceId, updatedCommit.id, 'main'),
    ).rejects.toMatchObject({ code: 'DIFF_TOO_LARGE' })
    expect((await getGitCommits(root, spaceId, firstPage.commitId, 1, 1)).commits[0]?.id).toBe(initialCommitId)
  })

  it('compares merge commits with the first parent and handles commits without file changes', async () => {
    const root = await createTemporaryRoot()
    await createSpaceStorage(root, spaceId, 'git')
    const worktree = join(root, 'merge-worktree')
    await execFileAsync('git', ['clone', getSpaceStoragePath(root, spaceId), worktree])
    await configureTestAuthor(worktree)
    const git = (args: string[]) => execFileAsync('git', ['-C', worktree, '-c', 'commit.gpgsign=false', ...args])
    await writeFile(join(worktree, 'base.txt'), 'Base\n')
    await git(['add', '.'])
    await git(['commit', '-m', 'Base'])
    await git(['branch', 'side'])
    await writeFile(join(worktree, 'main.txt'), 'Main only\n')
    await git(['add', '.'])
    await git(['commit', '-m', 'Main change'])
    const mainParent = (await git(['rev-parse', 'HEAD'])).stdout.trim()
    await git(['switch', 'side'])
    await writeFile(join(worktree, 'side.txt'), 'Side change\n')
    await git(['add', '.'])
    await git(['commit', '-m', 'Side change'])
    await git(['switch', 'main'])
    await git(['merge', '--no-ff', 'side', '-m', 'Merge side'])
    await git(['push', 'origin', 'main'])
    const merge = await getGitCommit(root, spaceId, 'main')
    expect(merge.parentIds).toHaveLength(2)
    const diff = await getGitDiff(root, spaceId, undefined, merge.id)
    expect(diff.from?.commitId).toBe(mainParent)
    expect(diff.patch).toContain('+Side change')
    expect(diff.patch).not.toContain('main.txt')
    const page = await getGitCommits(root, spaceId, 'main')
    expect(page.commits).toHaveLength(4)
    expect(page.commits[0]?.id).toBe(merge.id)
    await git(['commit', '--allow-empty', '-m', 'No file changes'])
    await git(['push', 'origin', 'main'])
    expect((await getGitDiff(root, spaceId, undefined, 'main')).patch).toBe('')
  })
})

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'enspatium-git-'))
  temporaryRoots.push(root)
  return root
}

async function configureTestAuthor(worktreePath: string): Promise<void> {
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
}
