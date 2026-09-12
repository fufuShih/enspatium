import { createHash } from 'node:crypto'
import { constants, type BigIntStats } from 'node:fs'
import { lstat, open, opendir } from 'node:fs/promises'
import { join } from 'node:path'
import type { IssueReporter } from './report.js'

export type ScannedFile = { path: string; stat: BigIntStats }
export type FileTree = {
  files: Map<string, ScannedFile>
  directories: Set<string>
  complete: boolean
}

export function errorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)
    ? code
    : 'UNKNOWN'
}

export async function inspectDirectory(
  path: string,
  issue: IssueReporter,
): Promise<BigIntStats | undefined> {
  try {
    const stat = await lstat(path, { bigint: true })
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      issue(
        {
          severity: 'error',
          code: 'UNSAFE_PATH',
          path,
          message:
            'Expected a real directory; links and other entry types are not followed.',
        },
        true,
      )
      return
    }
    return stat
  } catch (error) {
    const missing = errorCode(error) === 'ENOENT'
    issue(
      {
        severity: 'error',
        code: missing ? 'DIRECTORY_MISSING' : 'DIRECTORY_UNREADABLE',
        path,
        message: missing
          ? 'Expected storage directory is missing.'
          : 'Cannot inspect storage directory.',
        detail: errorCode(error),
      },
      !missing,
    )
  }
}

// Iterative traversal handles legacy nested locators without recursive call stacks.
// Never follow symlinks/junctions, including those inside a Git repository.
export async function inspectTree(
  root: string,
  issue: IssueReporter,
  signal?: AbortSignal,
): Promise<FileTree> {
  const tree: FileTree = {
    files: new Map(),
    directories: new Set(),
    complete: true,
  }
  const pending = [{ path: root, key: '' }]
  while (pending.length) {
    signal?.throwIfAborted()
    const directory = pending.pop()!
    try {
      const before = await lstat(directory.path, { bigint: true })
      if (before.isSymbolicLink() || !before.isDirectory())
        throw new Error('Directory changed during traversal')
      const entries = await opendir(directory.path)
      for await (const entry of entries) {
        signal?.throwIfAborted()
        const path = join(directory.path, entry.name)
        const key = directory.key
          ? directory.key + '/' + entry.name
          : entry.name
        const stat = await lstat(path, { bigint: true })
        if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
          tree.complete = false
          issue(
            {
              severity: 'error',
              code: 'UNSAFE_PATH',
              path,
              message: 'Links and special files are not followed.',
            },
            true,
          )
        } else if (stat.isDirectory()) {
          tree.directories.add(key)
          pending.push({ path, key })
        } else tree.files.set(key, { path, stat })
      }
      const after = await lstat(directory.path, { bigint: true })
      if (
        after.isSymbolicLink() ||
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.mtimeNs !== after.mtimeNs ||
        before.ctimeNs !== after.ctimeNs
      ) {
        tree.complete = false
        issue(
          {
            severity: 'error',
            code: 'STORAGE_CHANGED',
            path: directory.path,
            message:
              'Directory changed during traversal. Inspect external writers and repeat.',
          },
          true,
        )
      }
    } catch (error) {
      signal?.throwIfAborted()
      tree.complete = false
      issue(
        {
          severity: 'error',
          code: 'DIRECTORY_UNREADABLE',
          path: directory.path,
          message:
            'Directory traversal could not finish. Missing files below it cannot be classified.',
          detail: errorCode(error),
        },
        true,
      )
    }
  }
  return tree
}

export function sameFile(a: BigIntStats, b: BigIntStats): boolean {
  return (
    a.isFile() === b.isFile() &&
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs
  )
}

export async function checksum(
  file: ScannedFile,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted()
  const handle = await open(
    file.path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  )
  try {
    if (!sameFile(file.stat, await handle.stat({ bigint: true })))
      throw new Error('FILE_CHANGED')
    const hash = createHash('sha256')
    for await (const chunk of handle.createReadStream({
      autoClose: false,
      ...(signal ? { signal } : {}),
    }))
      hash.update(chunk)
    if (
      !sameFile(file.stat, await handle.stat({ bigint: true })) ||
      !sameFile(file.stat, await lstat(file.path, { bigint: true }))
    )
      throw new Error('FILE_CHANGED')
    return hash.digest('hex')
  } finally {
    await handle.close()
  }
}
