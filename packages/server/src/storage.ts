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
const gitFieldSeparator = '\u001f'
const gitRecordSeparator = '\u001e'

export interface GitCommit {
  id: string
  shortId: string
  authorName: string
  authorEmail: string
  authoredAt: string
  message: string
}

export interface GitRepositoryInfo {
  defaultBranch: string
  branches: string[]
  commits: GitCommit[]
}

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
    spaceType === 'git' ? `git/${spaceId}.git` : `objects/${spaceId}`
  const target = resolve(root, relativePath)
  const pathFromRoot = relative(root, target)

  if (
    !pathFromRoot ||
    pathFromRoot === '..' ||
    pathFromRoot.startsWith(`..${sep}`) ||
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

export async function getGitRepositoryInfo(
  dataRoot: string,
  spaceId: string,
): Promise<GitRepositoryInfo> {
  const repositoryPath = getSpaceStoragePath(dataRoot, spaceId, 'git')

  const [defaultBranchOutput, branchesOutput] = await Promise.all([
    runGit(repositoryPath, ['symbolic-ref', '--short', 'HEAD']),
    runGit(repositoryPath, [
      'for-each-ref',
      '--sort=refname',
      '--format=%(refname:short)',
      'refs/heads/',
    ]),
  ])

  const branches = branchesOutput
    .split('\n')
    .map((branch) => branch.trim())
    .filter(Boolean)

  if (branches.length === 0) {
    return {
      defaultBranch: defaultBranchOutput.trim(),
      branches,
      commits: [],
    }
  }

  const commitsOutput = await runGit(repositoryPath, [
    'log',
    '--all',
    '--max-count=20',
    `--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e`,
  ])

  return {
    defaultBranch: defaultBranchOutput.trim(),
    branches,
    commits: parseGitCommits(commitsOutput),
  }
}

async function runGit(
  repositoryPath: string,
  arguments_: string[],
): Promise<string> {
  const { stdout } = await execFileAsync(
    'git',
    [`--git-dir=${repositoryPath}`, ...arguments_],
    {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 10_000,
      windowsHide: true,
    },
  )

  return stdout
}

function parseGitCommits(output: string): GitCommit[] {
  return output
    .split(gitRecordSeparator)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [id, shortId, authorName, authorEmail, authoredAt, message] =
        record.split(gitFieldSeparator)

      if (
        !id ||
        !shortId ||
        authorName === undefined ||
        authorEmail === undefined ||
        !authoredAt ||
        message === undefined
      ) {
        throw new Error('failed to parse Git commit')
      }

      return {
        id,
        shortId,
        authorName,
        authorEmail,
        authoredAt,
        message,
      }
    })
}
