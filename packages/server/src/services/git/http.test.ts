import { execFile } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

import { parseGitBasicToken } from '../../routes/git.route.js'
import { createSpaceStorage, getSpaceStoragePath } from '../space/storage.js'
import {
  serveGitHttpBackend,
  type GitHttpService,
  type GitHttpServicePath,
} from './http.js'

const execFileAsync = promisify(execFile)
const spaceId = '00000000-0000-4000-8000-000000000001'
const temporaryRoots: string[] = []
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolvePromise, reject) => {
          server.closeAllConnections()
          server.close((error) => {
            if (error) {
              reject(error)
              return
            }

            resolvePromise()
          })
        }),
    ),
  )

  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('Git Smart HTTP', () => {
  it(
    'serves clone, fetch and push through Smart HTTP',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'enspatium-git-http-'))
      const repositoryPath = getSpaceStoragePath(root, spaceId)
      const sourcePath = join(root, 'source')
      const clonePath = join(root, 'clone')

      temporaryRoots.push(root)
      await createSpaceStorage(root, spaceId, 'git')
      await execFileAsync('git', ['clone', repositoryPath, sourcePath])
      await configureTestAuthor(sourcePath)
      await writeFile(join(sourcePath, 'README.md'), '# HTTP Git\n', 'utf8')
      await commitAndPush(sourcePath, 'Initial commit')
      await execFileAsync('git', [
        '--git-dir=' + repositoryPath,
        'symbolic-ref',
        'HEAD',
        'refs/heads/main',
      ])

      const server = createGitTestServer(root)
      const port = await listen(server)
      const repositoryUrl =
        'http://127.0.0.1:' + String(port) + '/repository.git'

      servers.push(server)
      await execFileAsync('git', ['clone', repositoryUrl, clonePath], {
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      })

      await expect(
        readFile(join(clonePath, 'README.md'), 'utf8'),
      ).resolves.toBe('# HTTP Git\n')

      await writeFile(join(sourcePath, 'CHANGELOG.md'), 'Second commit\n', 'utf8')
      await commitAndPush(sourcePath, 'Second commit')
      await execFileAsync('git', ['-C', clonePath, 'fetch', 'origin'], {
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      })
      const { stdout } = await execFileAsync('git', [
        '-C',
        clonePath,
        'show',
        'origin/main:CHANGELOG.md',
      ])

      expect(stdout).toBe('Second commit\n')

      await execFileAsync('git', [
        '-C',
        clonePath,
        'reset',
        '--hard',
        'origin/main',
      ])
      await configureTestAuthor(clonePath)
      await writeFile(join(clonePath, 'PUSHED.md'), 'HTTP push\n', 'utf8')
      await commitAndPush(clonePath, 'HTTP push')
      const pushedFile = await execFileAsync('git', [
        '--git-dir=' + repositoryPath,
        'show',
        'refs/heads/main:PUSHED.md',
      ])

      expect(pushedFile.stdout).toBe('HTTP push\n')
    },
    30_000,
  )

  it('reads a PAT from an HTTP Basic password', () => {
    const token = 'ensp_' + 'a'.repeat(43)
    const authorization =
      'Basic ' + Buffer.from('git:' + token).toString('base64')

    expect(parseGitBasicToken(authorization)).toBe(token)
    expect(parseGitBasicToken('Bearer ' + token)).toBeUndefined()
    expect(parseGitBasicToken('Basic invalid')).toBeUndefined()
  })
})

function createGitTestServer(dataRoot: string): Server {
  return createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    let service: GitHttpService | undefined
    let servicePath: GitHttpServicePath | undefined
    const requestedService = url.searchParams.get('service')

    if (
      request.method === 'GET' &&
      url.pathname.endsWith('/info/refs') &&
      (requestedService === 'git-upload-pack' ||
        requestedService === 'git-receive-pack')
    ) {
      service = requestedService
      servicePath = 'info/refs'
    } else if (
      request.method === 'POST' &&
      url.pathname.endsWith('/git-upload-pack')
    ) {
      service = 'git-upload-pack'
      servicePath = 'git-upload-pack'
    } else if (
      request.method === 'POST' &&
      url.pathname.endsWith('/git-receive-pack')
    ) {
      service = 'git-receive-pack'
      servicePath = 'git-receive-pack'
    }

    if (!service || !servicePath) {
      response.writeHead(404)
      response.end()
      return
    }

    void serveGitHttpBackend({
      request,
      response,
      dataRoot,
      spaceId,
      service,
      servicePath,
      remoteUser: 'test-user',
    }).catch((error: unknown) => {
      if (!response.headersSent) {
        response.writeHead(500)
        response.end(error instanceof Error ? error.message : String(error))
        return
      }

      response.destroy(error instanceof Error ? error : undefined)
    })
  })
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })

  const address = server.address()

  if (!address || typeof address === 'string') {
    throw new Error('test Git HTTP server has no TCP address')
  }

  return address.port
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

async function commitAndPush(
  worktreePath: string,
  message: string,
): Promise<void> {
  await execFileAsync('git', ['-C', worktreePath, 'add', '.'])
  await execFileAsync('git', [
    '-C',
    worktreePath,
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    message,
  ])
  await execFileAsync('git', [
    '-C',
    worktreePath,
    'push',
    'origin',
    'HEAD:main',
  ])
}
