import { devNull } from 'node:os'
import { join } from 'node:path'
import type { FileTree } from './filesystem.js'
import { errorCode } from './filesystem.js'
import type { IssueReporter } from './report.js'

import { execGit } from '../git/process.js'

export async function checkGit(
  path: string,
  tree: FileTree,
  deep: boolean,
  issue: IssueReporter,
  signal?: AbortSignal,
): Promise<void> {
  if (!tree.complete) return
  for (const [name, file] of tree.files) {
    if (name.startsWith('.ensp-push-') || name.startsWith('.ensp-hooks-'))
      issue({
        severity: 'warning', code: 'GIT_UPLOAD_TEMPORARY', path: file.path,
        message: 'Temporary Git upload data remains after an interrupted server process. Inspect it with the service stopped before removing it.',
      })
    if (name.endsWith('.lock'))
      issue({
        severity: 'warning',
        code: 'GIT_LOCK_FILE',
        path: file.path,
        message:
          'Git lock file remains. Verify that no Git process is running before inspecting it manually.',
      })
  }
  if (
    !tree.files.has('HEAD') ||
    !tree.files.has('config') ||
    !tree.directories.has('objects') ||
    !tree.directories.has('refs')
  ) {
    issue({
      severity: 'error',
      code: 'GIT_INVALID_REPOSITORY',
      path,
      message: 'Bare repository is missing HEAD, config, objects or refs.',
    })
    return
  }
  if (
    tree.files.has('commondir') ||
    tree.files.has('objects/info/alternates') ||
    tree.files.has('objects/info/http-alternates')
  ) {
    issue(
      {
        severity: 'error',
        code: 'GIT_EXTERNAL_STORAGE',
        path,
        message:
          'External Git object stores or common directories require manual inspection.',
      },
      true,
    )
    return
  }
  const environment: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.toUpperCase().startsWith('GIT_'),
    ),
  )
  Object.assign(environment, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : devNull,
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_NO_LAZY_FETCH: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    LC_ALL: 'C',
  })
  async function git(args: string[]) {
    signal?.throwIfAborted()
    try {
      const result = await execGit(
        [
          '--git-dir',
          path,
          '-c',
          'core.fsmonitor=false',
          '-c',
          'gc.auto=0',
          ...args,
        ],
        {
          env: environment,
          windowsHide: true,
          timeout: 60_000,
          maxBuffer: 4 * 1024 * 1024,
          ...(signal ? { signal } : {}),
        },
      )
      return { code: 0, ...result }
    } catch (error) {
      signal?.throwIfAborted()
      const failure = error as {
        code?: number
        killed?: boolean
        stdout?: string
        stderr?: string
      }
      if (typeof failure.code !== 'number' || failure.killed) {
        issue(
          {
            severity: 'error',
            code: 'GIT_CHECK_FAILED',
            path,
            message:
              'Git could not finish. Check Git installation, timeout and output limits.',
            detail: errorCode(error),
          },
          true,
        )
        return
      }
      return {
        code: failure.code,
        stdout: failure.stdout ?? '',
        stderr: failure.stderr ?? '',
      }
    }
  }
  const details = (r: { stdout: string; stderr: string }) =>
    (r.stdout + '\n' + r.stderr).trim().slice(0, 8000)
  // Do not read external includes or let repository fsck overrides suppress errors.
  const config = await git([
    'config',
    '--file',
    join(path, 'config'),
    '--no-includes',
    '--get-regexp',
    '^(include[.]|includeif[.]|fsck[.])',
  ])
  if (!config) return
  if (config.code === 0) {
    issue(
      {
        severity: 'error',
        code: 'GIT_UNSUPPORTED_CONFIG',
        path,
        message:
          'Repository config includes or custom fsck rules need manual review before checking.',
      },
      true,
    )
    return
  }
  if (config.code !== 1) {
    issue({
      severity: 'error',
      code: 'GIT_INVALID_CONFIG',
      path,
      message: 'Git configuration is invalid.',
      detail: details(config),
    })
    return
  }
  const bare = await git(['rev-parse', '--is-bare-repository'])
  if (!bare) return
  if (bare.code || bare.stdout.trim() !== 'true') {
    issue({
      severity: 'error',
      code: 'GIT_INVALID_REPOSITORY',
      path,
      message: 'Storage is not a valid bare repository.',
      detail: details(bare),
    })
    return
  }
  const refs = await git(['for-each-ref', '--format=%(refname) %(objecttype)'])
  const head = await git(['symbolic-ref', '--quiet', 'HEAD'])
  if (!refs || !head) return
  const branches = refs.stdout.trim().split(/\r?\n/).filter(Boolean)
  if (
    refs.code ||
    refs.stderr.trim() ||
    branches.some(
      (line) => line.startsWith('refs/heads/') && !line.endsWith(' commit'),
    )
  ) {
    issue({
      severity: 'error',
      code: 'GIT_INVALID_REFS',
      path,
      message: 'Git references cannot be resolved correctly.',
      detail: details(refs),
    })
  }
  const headRef = head.stdout.trim()
  if (head.code || !headRef.startsWith('refs/heads/')) {
    issue({
      severity: 'error',
      code: 'GIT_INVALID_HEAD',
      path,
      message: 'Hosted repository HEAD must name a branch.',
      detail: details(head),
    })
  } else if (
    branches.length &&
    !branches.some((line) => line === headRef + ' commit')
  ) {
    issue({
      severity: 'error',
      code: 'GIT_HEAD_MISSING',
      path,
      message: 'HEAD points to a missing branch while other refs exist.',
      detail: headRef,
    })
  }
  if (!deep) return
  const fsck = await git(['fsck', '--full', '--no-progress'])
  if (!fsck) return
  if (fsck.code) {
    issue({
      severity: 'error',
      code: 'GIT_CORRUPT',
      path,
      message: 'Git object integrity verification failed.',
      detail: details(fsck),
    })
    return
  }
  const lines = (fsck.stdout + '\n' + fsck.stderr)
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
  const dangling = lines.filter((line) => line.startsWith('dangling '))
  if (dangling.length)
    issue({
      severity: 'info',
      code: 'GIT_DANGLING_OBJECTS',
      path,
      message:
        'Git reports unreferenced objects; this alone is not corruption.',
      detail: dangling.join('\n').slice(0, 8000),
    })
  const notices = lines.filter(
    (line) =>
      !line.startsWith('dangling ') &&
      !(
        branches.length === 0 &&
        (line.startsWith('notice: HEAD points to an unborn branch') ||
          line === 'notice: No default references')
      ),
  )
  if (notices.length)
    issue({
      severity: 'warning',
      code: 'GIT_DIAGNOSTIC',
      path,
      message: 'Git reported additional diagnostics.',
      detail: notices.join('\n').slice(0, 8000),
    })
}
