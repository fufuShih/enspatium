import { execFile } from 'node:child_process'
import { promisify, TextDecoder } from 'node:util'

import { getSpaceStoragePath } from '../../storage.js'

const execFileAsync = promisify(execFile)
const gitFieldSeparator = '\u001f'
const gitRecordSeparator = '\u001e'
const maxGitFileSize = 1024 * 1024
const maxGitDiffSize = 1024 * 1024
const readmeNames = [
  'README.md',
  'README.markdown',
  'README.rst',
  'README.adoc',
  'README.txt',
  'README',
]

export type GitStorageErrorCode =
  | 'INVALID_PATH'
  | 'REF_NOT_FOUND'
  | 'PATH_NOT_FOUND'
  | 'NOT_A_DIRECTORY'
  | 'NOT_A_FILE'
  | 'FILE_TOO_LARGE'
  | 'DIFF_TOO_LARGE'

export class GitStorageError extends Error {
  constructor(
    readonly code: GitStorageErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause })
    this.name = 'GitStorageError'
  }
}

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

export interface GitTag {
  name: string
  commitId: string
}

export interface GitCommitDetail {
  ref: string
  id: string
  shortId: string
  parentIds: string[]
  authorName: string
  authorEmail: string
  authoredAt: string
  committerName: string
  committerEmail: string
  committedAt: string
  message: string
}

export interface GitDiffRevision {
  ref: string
  commitId: string
}

export interface GitDiff {
  from: GitDiffRevision
  to: GitDiffRevision
  patch: string
}

export type GitTreeEntryType =
  | 'file'
  | 'directory'
  | 'symlink'
  | 'submodule'

export interface GitTreeEntry {
  id: string
  name: string
  path: string
  type: GitTreeEntryType
  size: number | null
}

export interface GitTree {
  ref: string
  commitId: string
  path: string
  entries: GitTreeEntry[]
}

export interface GitFile {
  ref: string
  commitId: string
  path: string
  name: string
  size: number
  encoding: 'utf-8' | 'base64'
  content: string
}

interface RawGitTreeEntry {
  mode: string
  objectType: 'blob' | 'tree' | 'commit'
  objectId: string
  size: number | null
  path: string
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
    '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e',
  ])

  return {
    defaultBranch: defaultBranchOutput.trim(),
    branches,
    commits: parseGitCommits(commitsOutput),
  }
}

export async function getGitTags(
  dataRoot: string,
  spaceId: string,
): Promise<GitTag[]> {
  const repositoryPath = getSpaceStoragePath(dataRoot, spaceId, 'git')
  const output = await runGit(repositoryPath, [
    'for-each-ref',
    '--sort=refname',
    '--format=%(refname:short)%09%(objecttype)%09%(objectname)%09%(*objecttype)%09%(*objectname)',
    'refs/tags/',
  ])

  return output
    .split('\n')
    .filter(Boolean)
    .flatMap((record) => {
      const [name, objectType, objectId, peeledType, peeledId] =
        record.split('\t')
      const commitId =
        objectType === 'commit'
          ? objectId
          : peeledType === 'commit'
            ? peeledId
            : undefined

      if (!name || !commitId) {
        return []
      }

      return [{ name, commitId }]
    })
}

export async function getGitCommit(
  dataRoot: string,
  spaceId: string,
  inputRef?: string,
): Promise<GitCommitDetail> {
  const repositoryPath = getSpaceStoragePath(dataRoot, spaceId, 'git')
  const { ref, commitId } = await resolveGitCommit(repositoryPath, inputRef)
  const output = await runGit(repositoryPath, [
    'show',
    '--no-patch',
    '--format=%H%x00%h%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%B%x00',
    commitId,
  ])
  const [
    id,
    shortId,
    parentIds,
    authorName,
    authorEmail,
    authoredAt,
    committerName,
    committerEmail,
    committedAt,
    message,
  ] = output.split('\0')

  if (
    !id ||
    !shortId ||
    parentIds === undefined ||
    authorName === undefined ||
    authorEmail === undefined ||
    !authoredAt ||
    committerName === undefined ||
    committerEmail === undefined ||
    !committedAt ||
    message === undefined
  ) {
    throw new Error('failed to parse Git commit detail')
  }

  return {
    ref,
    id,
    shortId,
    parentIds: parentIds.split(' ').filter(Boolean),
    authorName,
    authorEmail,
    authoredAt,
    committerName,
    committerEmail,
    committedAt,
    message: message.trimEnd(),
  }
}

export async function getGitDiff(
  dataRoot: string,
  spaceId: string,
  inputFromRef: string,
  inputToRef: string,
): Promise<GitDiff> {
  const repositoryPath = getSpaceStoragePath(dataRoot, spaceId, 'git')
  const [from, to] = await Promise.all([
    resolveGitCommit(repositoryPath, inputFromRef),
    resolveGitCommit(repositoryPath, inputToRef),
  ])
  let patch: string

  try {
    patch = await runGit(
      repositoryPath,
      [
        'diff',
        '--no-color',
        '--no-ext-diff',
        '--no-textconv',
        '--find-renames',
        from.commitId,
        to.commitId,
        '--',
      ],
      maxGitDiffSize + 1,
    )
  } catch (error) {
    if (isMaxBufferError(error)) {
      throw new GitStorageError(
        'DIFF_TOO_LARGE',
        'Git diff exceeds the 1 MiB response limit',
        error,
      )
    }

    throw error
  }

  if (Buffer.byteLength(patch, 'utf8') > maxGitDiffSize) {
    throw new GitStorageError(
      'DIFF_TOO_LARGE',
      'Git diff exceeds the 1 MiB response limit',
    )
  }

  return {
    from,
    to,
    patch,
  }
}

export async function getGitTree(
  dataRoot: string,
  spaceId: string,
  inputRef?: string,
  inputPath = '',
): Promise<GitTree> {
  const repositoryPath = getSpaceStoragePath(dataRoot, spaceId, 'git')
  const path = normalizeGitPath(inputPath, true)
  const { ref, commitId } = await resolveGitCommit(repositoryPath, inputRef)

  let treeId: string

  if (path) {
    const entry = await findGitTreeEntry(repositoryPath, commitId, path)

    if (!entry) {
      throw new GitStorageError('PATH_NOT_FOUND', 'Git path not found')
    }

    if (entry.objectType !== 'tree') {
      throw new GitStorageError(
        'NOT_A_DIRECTORY',
        'Git path is not a directory',
      )
    }

    treeId = entry.objectId
  } else {
    treeId = (
      await runGit(repositoryPath, [
        'rev-parse',
        '--verify',
        commitId + '^{tree}',
      ])
    ).trim()
  }

  const output = await runGit(repositoryPath, ['ls-tree', '-z', '-l', treeId])

  return {
    ref,
    commitId,
    path,
    entries: parseGitTreeEntries(output).map((entry) => ({
      id: entry.objectId,
      name: entry.path,
      path: path ? path + '/' + entry.path : entry.path,
      type: toGitTreeEntryType(entry),
      size: entry.size,
    })),
  }
}

export async function getGitFile(
  dataRoot: string,
  spaceId: string,
  inputRef: string | undefined,
  inputPath: string,
): Promise<GitFile> {
  const repositoryPath = getSpaceStoragePath(dataRoot, spaceId, 'git')
  const path = normalizeGitPath(inputPath, false)
  const { ref, commitId } = await resolveGitCommit(repositoryPath, inputRef)
  const entry = await findGitTreeEntry(repositoryPath, commitId, path)

  if (!entry) {
    throw new GitStorageError('PATH_NOT_FOUND', 'Git path not found')
  }

  if (entry.objectType !== 'blob') {
    throw new GitStorageError('NOT_A_FILE', 'Git path is not a file')
  }

  if (entry.size === null || entry.size > maxGitFileSize) {
    throw new GitStorageError(
      'FILE_TOO_LARGE',
      'Git file exceeds the 1 MiB response limit',
    )
  }

  const contents = await runGitBuffer(
    repositoryPath,
    ['cat-file', 'blob', entry.objectId],
    maxGitFileSize + 1,
  )
  const encoded = encodeGitFile(contents)

  return {
    ref,
    commitId,
    path,
    name: path.split('/').at(-1) ?? path,
    size: entry.size,
    encoding: encoded.encoding,
    content: encoded.content,
  }
}

export async function getGitReadme(
  dataRoot: string,
  spaceId: string,
  inputRef?: string,
): Promise<GitFile | null> {
  const tree = await getGitTree(dataRoot, spaceId, inputRef)
  const entriesByName = new Map(
    tree.entries.map((entry) => [entry.name.toLowerCase(), entry]),
  )

  for (const readmeName of readmeNames) {
    const entry = entriesByName.get(readmeName.toLowerCase())

    if (entry?.type === 'file') {
      return getGitFile(dataRoot, spaceId, tree.ref, entry.path)
    }
  }

  return null
}

async function runGit(
  repositoryPath: string,
  arguments_: string[],
  maxBuffer = 1024 * 1024,
): Promise<string> {
  const { stdout } = await execFileAsync(
    'git',
    ['--git-dir=' + repositoryPath, ...arguments_],
    {
      encoding: 'utf8',
      maxBuffer,
      timeout: 10_000,
      windowsHide: true,
    },
  )

  return stdout
}

function isMaxBufferError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
  )
}

async function runGitBuffer(
  repositoryPath: string,
  arguments_: string[],
  maxBuffer: number,
): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      'git',
      ['--git-dir=' + repositoryPath, ...arguments_],
      {
        encoding: 'buffer',
        maxBuffer,
        timeout: 10_000,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          reject(error)
          return
        }

        resolvePromise(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout))
      },
    )
  })
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

async function resolveGitCommit(
  repositoryPath: string,
  inputRef?: string,
): Promise<{ ref: string; commitId: string }> {
  try {
    const ref = inputRef?.trim()
      ? validateGitRef(inputRef)
      : (
          await runGit(repositoryPath, [
            'symbolic-ref',
            '--short',
            'HEAD',
          ])
        ).trim()
    const commitId = (
      await runGit(repositoryPath, [
        'rev-parse',
        '--verify',
        '--end-of-options',
        ref + '^{commit}',
      ])
    ).trim()

    return { ref, commitId }
  } catch (error) {
    if (error instanceof GitStorageError) {
      throw error
    }

    throw new GitStorageError('REF_NOT_FOUND', 'Git ref not found', error)
  }
}

function validateGitRef(input: string): string {
  const ref = input.trim()

  if (!ref || ref.length > 255 || ref.includes('\0')) {
    throw new GitStorageError('REF_NOT_FOUND', 'Git ref not found')
  }

  return ref
}

function normalizeGitPath(input: string, allowEmpty: boolean): string {
  const path = input.replaceAll('\\', '/')

  if (path.includes('\0') || path.startsWith('/')) {
    throw new GitStorageError('INVALID_PATH', 'invalid Git path')
  }

  const segments = path.split('/').filter(Boolean)

  if (
    segments.some((segment) => segment === '.' || segment === '..') ||
    (!allowEmpty && segments.length === 0)
  ) {
    throw new GitStorageError('INVALID_PATH', 'invalid Git path')
  }

  return segments.join('/')
}

async function findGitTreeEntry(
  repositoryPath: string,
  commitId: string,
  path: string,
): Promise<RawGitTreeEntry | undefined> {
  const output = await runGit(repositoryPath, [
    'ls-tree',
    '-z',
    '-l',
    commitId,
    '--',
    ':(literal)' + path,
  ])

  return parseGitTreeEntries(output).find((entry) => entry.path === path)
}

function parseGitTreeEntries(output: string): RawGitTreeEntry[] {
  return output
    .split('\0')
    .filter(Boolean)
    .map((record) => {
      const tabIndex = record.indexOf('\t')

      if (tabIndex < 0) {
        throw new Error('failed to parse Git tree entry')
      }

      const metadata = record.slice(0, tabIndex).trim().split(/\s+/)
      const [mode, objectType, objectId, sizeText] = metadata
      const path = record.slice(tabIndex + 1)

      if (
        !mode ||
        (objectType !== 'blob' &&
          objectType !== 'tree' &&
          objectType !== 'commit') ||
        !objectId ||
        !sizeText ||
        !path
      ) {
        throw new Error('failed to parse Git tree entry')
      }

      const size = sizeText === '-' ? null : Number.parseInt(sizeText, 10)

      if (size !== null && !Number.isSafeInteger(size)) {
        throw new Error('failed to parse Git tree entry size')
      }

      return {
        mode,
        objectType,
        objectId,
        size,
        path,
      }
    })
}

function toGitTreeEntryType(entry: RawGitTreeEntry): GitTreeEntryType {
  if (entry.objectType === 'tree') {
    return 'directory'
  }

  if (entry.objectType === 'commit') {
    return 'submodule'
  }

  return entry.mode === '120000' ? 'symlink' : 'file'
}

function encodeGitFile(contents: Buffer): {
  encoding: 'utf-8' | 'base64'
  content: string
} {
  try {
    return {
      encoding: 'utf-8',
      content: new TextDecoder('utf-8', { fatal: true }).decode(contents),
    }
  } catch {
    return {
      encoding: 'base64',
      content: contents.toString('base64'),
    }
  }
}
