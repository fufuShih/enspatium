import { execFile, spawn } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { TextDecoder } from 'node:util'

import { requireSpaceStorage } from '../space/storage.js'
import { acquireGitProcess, execGit, GitCapacityError, terminateGitTree } from './process.js'

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

export interface GitReferencePage {
  items: { name: string; type: 'branch' | 'tag'; commit: GitCommit & { committedAt: string } }[]
  total: number
  hasMore: boolean
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
  from: GitDiffRevision | null
  to: GitDiffRevision
  patch: string
}

export interface GitCommitPage {
  ref: string
  commitId: string
  commits: GitCommit[]
  hasMore: boolean
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

export interface GitFileInfo {
  ref: string
  commitId: string
  path: string
  name: string
  size: number
}

export interface GitFile extends GitFileInfo {
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

// A push creates branch refs but Git does not update an unborn bare HEAD.
// Preserve a valid default; otherwise prefer main, then the first branch.
export async function synchronizeGitHead(dataRoot: string, spaceId: string): Promise<void> {
  const repositoryPath = await requireSpaceStorage(dataRoot, spaceId, 'git', true)
  await synchronizeGitHeadAtPath(repositoryPath)
}

export async function synchronizeGitHeadAtPath(repositoryPath: string, command = runGit): Promise<void> {
  const headOutput = await command(repositoryPath, ['symbolic-ref', 'HEAD'])
  const branchesOutput = await command(repositoryPath, ['for-each-ref', '--sort=refname', '--format=%(refname)', 'refs/heads/'])
  const branches = branchesOutput.trim().split('\n').filter(Boolean)
  if (branches.length === 0 || branches.includes(headOutput.trim())) return
  const branch = branches.includes('refs/heads/main') ? 'refs/heads/main' : branches[0]!
  await command(repositoryPath, ['symbolic-ref', 'HEAD', branch])
}

export async function setGitDefaultBranch(dataRoot: string, spaceId: string, branch: string): Promise<void> {
  if (!branch || branch.length > 255 || branch !== branch.trim()) {
    throw new GitStorageError('REF_NOT_FOUND', 'Git branch not found')
  }
  const repositoryPath = await requireSpaceStorage(dataRoot, spaceId, 'git', true)
  const branches = await runGit(repositoryPath, ['for-each-ref', '--format=%(refname)', 'refs/heads/'])
  const ref = 'refs/heads/' + branch
  if (!branches.split('\n').includes(ref)) {
    throw new GitStorageError('REF_NOT_FOUND', 'Git branch not found')
  }
  await runGit(repositoryPath, ['symbolic-ref', 'HEAD', ref])
}

export async function getGitRepositoryInfo(
  dataRoot: string,
  spaceId: string,
): Promise<GitRepositoryInfo> {
  const repositoryPath = await requireSpaceStorage(dataRoot, spaceId, 'git')

  const defaultBranchOutput = await runGit(repositoryPath, ['symbolic-ref', 'HEAD'])
  const branchesOutput = await runGit(repositoryPath, [
    'for-each-ref',
    '--sort=refname',
    '--format=%(refname)',
    'refs/heads/',
  ])

  const branches = branchesOutput
    .split('\n')
    .filter(Boolean)
    .map((branch) => branch.slice('refs/heads/'.length))

  if (branches.length === 0) {
    return {
      defaultBranch: defaultBranchOutput.trim().slice('refs/heads/'.length),
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
    defaultBranch: defaultBranchOutput.trim().slice('refs/heads/'.length),
    branches,
    commits: parseGitCommits(commitsOutput),
  }
}

export async function getGitCommits(
  dataRoot: string,
  spaceId: string,
  inputRef?: string,
  offset = 0,
  limit = 30,
): Promise<GitCommitPage> {
  const repositoryPath = await requireSpaceStorage(dataRoot, spaceId, 'git')
  const revision = await resolveGitCommit(repositoryPath, inputRef)
  const output = await runGit(repositoryPath, [
    'log',
    '--topo-order',
    `--skip=${offset}`,
    `--max-count=${limit + 1}`,
    '--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%s%x00',
    revision.commitId,
    '--',
  ])
  // NUL fields preserve commit subjects containing control separators.
  const fields = output.split('\0')
  const commits: GitCommit[] = []
  for (let index = 0; index + 5 < fields.length; index += 6) {
    commits.push({
      id: fields[index]!.trim(),
      shortId: fields[index + 1]!,
      authorName: fields[index + 2]!,
      authorEmail: fields[index + 3]!,
      authoredAt: fields[index + 4]!,
      message: fields[index + 5]!,
    })
  }
  return { ...revision, commits: commits.slice(0, limit), hasMore: commits.length > limit }
}

export async function getGitTags(
  dataRoot: string,
  spaceId: string,
): Promise<GitTag[]> {
  const repositoryPath = await requireSpaceStorage(dataRoot, spaceId, 'git')
  const output = await runGit(repositoryPath, [
    'for-each-ref',
    '--sort=refname',
    '--format=%(refname)%09%(objecttype)%09%(objectname)%09%(*objecttype)%09%(*objectname)',
    'refs/tags/',
  ])

  const tags: GitTag[] = []
  for (const record of output.split('\n').filter(Boolean)) {
    const [name, objectType, objectId, peeledType, peeledId] =
      record.split('\t')
    let commitId =
      objectType === 'commit'
        ? objectId
        : peeledType === 'commit'
          ? peeledId
          : undefined

    if (name && objectType === 'tag' && peeledType === 'tag') {
      // Annotated tags may point to another annotated tag. Peel the complete
      // chain, retaining the existing API's commit-tag-only contract.
      try { commitId = (await runGit(repositoryPath, ['rev-parse', '--verify', '--end-of-options', objectId + '^{commit}'])).trim() }
      catch (error) { if ((error as { code?: unknown }).code !== 128) throw error }
    }
    if (name && commitId) tags.push({ name: name.slice('refs/tags/'.length), commitId })
  }
  return tags
}

export async function listGitReferences(
  dataRoot: string, spaceId: string, type: 'branch' | 'tag', search = '', offset = 0, limit = 30,
): Promise<GitReferencePage> {
  const repositoryPath = await requireSpaceStorage(dataRoot, spaceId, 'git')
  const refs = type === 'tag' ? await getGitTags(dataRoot, spaceId) : (await runGit(repositoryPath, [
    'for-each-ref', '--sort=refname', '--format=%(refname)%09%(objectname)', 'refs/heads/',
  ])).split('\n').filter(Boolean).map(record => {
    const [name, commitId] = record.split('\t')
    return { name: name!.slice('refs/heads/'.length), commitId: commitId! }
  })
  const matches = refs.filter(ref => ref.name.toLowerCase().includes(search.toLowerCase()))
  const page = matches.slice(offset, offset + limit)
  if (!page.length) return { items: [], total: matches.length, hasMore: false }
  // One bounded metadata command per page, pinned to the captured IDs even if
  // refs change during the request. Do not walk each branch's history.
  const fields = (await runGit(repositoryPath, [
    'log', '--no-walk=unsorted', '--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%cI%x00%s%x00',
    ...new Set(page.map(ref => ref.commitId)), '--',
  ])).split('\0')
  const commits = new Map<string, GitCommit & { committedAt: string }>()
  for (let i = 0; i + 6 < fields.length; i += 7) {
    const id = fields[i]!.trim()
    commits.set(id, { id, shortId: fields[i + 1]!, authorName: fields[i + 2]!, authorEmail: fields[i + 3]!, authoredAt: fields[i + 4]!, committedAt: fields[i + 5]!, message: fields[i + 6]! })
  }
  return {
    items: page.map(ref => {
      const commit = commits.get(ref.commitId)
      if (!commit) throw new Error('failed to read reference commit')
      return { name: ref.name, type, commit }
    }),
    total: matches.length,
    hasMore: offset + page.length < matches.length,
  }
}

export async function getGitCommit(
  dataRoot: string,
  spaceId: string,
  inputRef?: string,
): Promise<GitCommitDetail> {
  const repositoryPath = await requireSpaceStorage(dataRoot, spaceId, 'git')
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
  inputFromRef: string | undefined,
  inputToRef: string,
): Promise<GitDiff> {
  const repositoryPath = await requireSpaceStorage(dataRoot, spaceId, 'git')
  const to = await resolveGitCommit(repositoryPath, inputToRef)
  let from: GitDiffRevision | null
  if (inputFromRef !== undefined) {
    from = await resolveGitCommit(repositoryPath, inputFromRef)
  } else {
    const parents = await runGit(repositoryPath, ['rev-list', '--parents', '-n', '1', to.commitId, '--'])
    const parentId = parents.trim().split(' ')[1]
    from = parentId ? { ref: parentId, commitId: parentId } : null
  }
  let patch: string

  try {
    patch = await runGit(
      repositoryPath,
      [
        ...(from ? ['diff'] : ['diff-tree', '--root', '--no-commit-id', '-r', '-p']),
        '--no-color',
        '--no-ext-diff',
        '--no-textconv',
        '--find-renames',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        ...(from ? [from.commitId] : []),
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
  const repositoryPath = await requireSpaceStorage(dataRoot, spaceId, 'git')
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
  const { repositoryPath, objectId, file } = await resolveGitFile(dataRoot, spaceId, inputRef, inputPath)
  if (file.size > maxGitFileSize) {
    throw new GitStorageError('FILE_TOO_LARGE', 'Git file exceeds the 1 MiB response limit')
  }
  const contents = await runGitBuffer(repositoryPath, ['cat-file', 'blob', objectId], maxGitFileSize + 1)
  return { ...file, ...encodeGitFile(contents) }
}

export async function getGitFileInfo(dataRoot: string, spaceId: string, inputRef: string | undefined, inputPath: string): Promise<GitFileInfo> {
  return (await resolveGitFile(dataRoot, spaceId, inputRef, inputPath)).file
}

export async function openGitFile(dataRoot: string, spaceId: string, inputRef: string | undefined, inputPath: string) {
  const { repositoryPath, objectId, file } = await resolveGitFile(dataRoot, spaceId, inputRef, inputPath)
  // Lazy creation lets HEAD return metadata without starting a content process.
  return { file, createReadStream: () => streamGitOutput(repositoryPath, ['cat-file', 'blob', objectId], file.size) }
}

export async function openGitArchive(dataRoot: string, spaceId: string, inputRef: string | undefined, spaceSlug: string) {
  const repositoryPath = await requireSpaceStorage(dataRoot, spaceId, 'git')
  const { commitId } = await resolveGitCommit(repositoryPath, inputRef)
  // The root directory and download name never contain a ref or a user path.
  const name = `${spaceSlug.replace(/[^a-z0-9-]/gi, '-') || 'repository'}-${commitId.slice(0, 7)}`
  return {
    file: { name: name + '.zip', commitId },
    createReadStream: () => streamGitOutput(repositoryPath, ['archive', '--format=zip', '--prefix=' + name + '/', commitId]),
  }
}

async function resolveGitFile(dataRoot: string, spaceId: string, inputRef: string | undefined, inputPath: string) {
  const repositoryPath = await requireSpaceStorage(dataRoot, spaceId, 'git')
  const path = normalizeGitPath(inputPath, false)
  const { ref, commitId } = await resolveGitCommit(repositoryPath, inputRef)
  const entry = await findGitTreeEntry(repositoryPath, commitId, path)

  if (!entry) {
    throw new GitStorageError('PATH_NOT_FOUND', 'Git path not found')
  }

  if (entry.objectType !== 'blob' || entry.size === null) {
    throw new GitStorageError('NOT_A_FILE', 'Git path is not a file')
  }

  return {
    repositoryPath, objectId: entry.objectId,
    file: { ref, commitId, path, name: path.split('/').at(-1) ?? path, size: entry.size },
  }
}

function streamGitOutput(repositoryPath: string, args: string[], expectedSize?: number) {
  // Callers pass resolved object IDs, never unchecked revisions or disk paths.
  const release = acquireGitProcess()
  const child = spawn('git', ['--git-dir=' + repositoryPath, ...args], {
    stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, detached: process.platform !== 'win32',
  })
  const stream = new PassThrough()
  const timeout = setTimeout(() => stream.destroy(new Error('Git content stream timed out')), 5 * 60 * 1000)
  let size = 0
  child.stdout.on('data', (chunk: Buffer) => { size += chunk.length })
  child.stdout.once('error', error => stream.destroy(error))
  child.once('error', () => stream.destroy(new Error('Unable to read Git content')))
  child.stdout.pipe(stream, { end: false })
  child.once('close', code => {
    clearTimeout(timeout)
    release()
    if (stream.destroyed) return
    if (code !== 0 || (expectedSize !== undefined && size !== expectedSize)) stream.destroy(new Error('Git content stream was interrupted'))
    else stream.end()
  })
  stream.once('close', () => {
    child.stdout.destroy()
    void terminateGitTree(child).catch(error => stream.destroy(error))
  })
  return stream
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
      return { ...await getGitFile(dataRoot, spaceId, tree.commitId, entry.path), ref: tree.ref }
    }
  }

  return null
}

async function runGit(
  repositoryPath: string,
  arguments_: string[],
  maxBuffer = 1024 * 1024,
): Promise<string> {
  const { stdout } = await execGit(
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
  const release = acquireGitProcess()
  return new Promise<Buffer>((resolvePromise, reject) => {
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
  }).finally(release)
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
    if (error instanceof GitStorageError || error instanceof GitCapacityError) {
      throw error
    }

    throw new GitStorageError('REF_NOT_FOUND', 'Git ref not found', error)
  }
}

function validateGitRef(input: string): string {
  const ref = input.trim()

  if (!ref || ref.length > 1024 || ref.includes('\0')) {
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
    if (contents.includes(0)) throw new Error('Binary content')
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
