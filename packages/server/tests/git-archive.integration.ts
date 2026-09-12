import { randomBytes } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect, vi } from 'vitest'
import { createFixture } from './fixture.js'
import type { PublicSpace } from '../src/db/space.types.js'
import type { PublicUser } from '../src/db/user.types.js'
import * as repository from '../src/services/git/repository.js'

test('ZIP archives resolve a commit once, stream with read access, and release canceled transfers', async ({ onTestFinished }) => {
  const { origin, root, session, git } = await createFixture({ after: cleanup => onTestFinished(cleanup), diagnostic: message => console.info(message) })
  const owner = session()
  const reader = session()
  const password = 'Archive-test-1234'
  const email = 'archive-owner@example.com'
  await owner.request('POST', '/users', 201, { email, password, displayName: 'Archive owner' })
  const member = await reader.request<PublicUser>('POST', '/users', 201, { email: 'archive-reader@example.com', password, displayName: 'Reader' })
  await owner.request('POST', '/auth/login', 200, { email, password })
  async function cookieFor(email: string) {
    const result = await fetch(origin + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })
    expect(result.status).toBe(200)
    await result.arrayBuffer()
    return result.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  }
  const cookie = await cookieFor(email)
  const readerCookie = await cookieFor(member.email)
  await owner.request('POST', '/namespaces', 201, { name: 'Archive team', slug: 'archive-team' })
  const base = '/namespaces/archive-team/spaces/source'
  const space = await owner.request<PublicSpace>('POST', '/namespaces/archive-team/spaces', 201, { name: 'Source', slug: 'source', type: 'git' })
  await owner.request('POST', '/namespaces/archive-team/members', 201, { email: member.email })
  await owner.request('POST', base + '/members', 201, { email: member.email, role: 'reader' })
  const url = (ref?: string) => base + '/git/archive' + (ref ? '?' + new URLSearchParams({ ref }) : '')
  async function read(ref: string | undefined, status = 200, auth = cookie, method = 'GET') {
    const response = await fetch(origin + url(ref), { method, headers: auth ? { cookie: auth } : {}, signal: AbortSignal.timeout(20_000) })
    const bytes = Buffer.from(await response.arrayBuffer())
    expect(response.status).toBe(status)
    return { response, bytes }
  }
  for (const method of ['GET', 'HEAD']) await read(undefined, 404, cookie, method)
  const source = join(root, 'archive-source')
  await git(['clone', join(root, 'data', space.id), source])
  const run = (args: string[]) => git(['-C', source, ...args])
  await run(['config', 'core.autocrlf', 'false'])
  await mkdir(join(source, 'docs'))
  await writeFile(join(source, 'README.md'), '# Original\n')
  await writeFile(join(source, 'docs', '中文 #%.txt'), 'Nested source\r\n')
  await writeFile(join(source, 'empty.txt'), '')
  // Incompressible data keeps the process active long enough to cancel a ZIP.
  await writeFile(join(source, 'large.bin'), randomBytes(8 * 1024 * 1024))
  await run(['add', '.'])
  await run(['commit', '-m', 'Archive source'])
  await run(['push', 'origin', 'HEAD:main'])
  const first = (await run(['rev-parse', 'HEAD'])).stdout.trim()
  await run(['tag', 'first'])
  await run(['push', 'origin', '--tags'])
  const prepared = await repository.openGitArchive(join(root, 'data'), space.id, 'main', space.slug)
  await writeFile(join(source, 'README.md'), '# Updated\n')
  await run(['add', '.'])
  await run(['commit', '-m', 'Update after archive resolution'])
  await run(['push', 'origin', 'HEAD:main'])
  const second = (await run(['rev-parse', 'HEAD'])).stdout.trim()
  const chunks: Buffer[] = []
  for await (const chunk of prepared.createReadStream()) chunks.push(chunk)
  expect(Buffer.concat(chunks).subarray(-40).toString()).toBe(first) // ZIP's Git commit comment.

  const realOpen = repository.openGitArchive
  const opened: Awaited<ReturnType<typeof realOpen>>[] = []
  vi.spyOn(repository, 'openGitArchive').mockImplementation(async (...args) => {
    const result = await realOpen(...args)
    vi.spyOn(result, 'createReadStream')
    opened.push(result)
    return result
  })
  onTestFinished(() => { vi.restoreAllMocks() })
  for (const [ref, commit] of [[undefined, second], ['refs/heads/main', second], [first, first], ['refs/tags/first', first]] as const) {
    const { response, bytes } = await read(ref, 200, readerCookie)
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50)
    expect(bytes.subarray(-40).toString()).toBe(commit)
    expect(bytes.includes(Buffer.from(`source-${commit.slice(0, 7)}/docs/中文 #%.txt`))).toBe(true)
    expect(response.headers.get('x-git-commit')).toBe(commit)
    expect(response.headers.get('content-type')).toBe('application/zip')
    expect(response.headers.get('content-disposition')).toContain(`attachment; filename="source-${commit.slice(0, 7)}.zip"`)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('content-length')).toBeNull()
    expect(response.headers.get('accept-ranges')).toBeNull()
  }
  const head = await read(first, 200, readerCookie, 'HEAD')
  expect(head.bytes.length).toBe(0)
  expect(head.response.headers.get('x-git-commit')).toBe(first)
  expect(head.response.headers.get('content-length')).toBeNull()
  expect(opened.at(-1)!.createReadStream).not.toHaveBeenCalled()
  await new Promise<void>((resolve, reject) => {
    const request = httpRequest(origin + url(first), { headers: { cookie } }, response => {
      expect(response.statusCode).toBe(200)
      response.once('data', () => { response.destroy(); resolve() })
      response.once('error', reject)
    })
    request.setTimeout(10_000, () => request.destroy(new Error('Archive timeout')))
    request.once('error', reject)
    request.end()
  })
  const canceled = vi.mocked(opened.at(-1)!.createReadStream).mock.results[0]!.value
  await expect.poll(() => canceled.destroyed).toBe(true)
  for (const ref of ['missing', '--output=unexpected.zip', 'HEAD:docs', '0'.repeat(40)]) await read(ref, 404)
  for (const method of ['GET', 'HEAD']) {
    const denied = await read(first, 401, '', method)
    expect(denied.response.headers.get('x-git-commit')).toBeNull()
  }
  await owner.request('DELETE', base + '/members/' + member.id, 204)
  const beforeDenied = opened.length
  for (const method of ['GET', 'HEAD']) await read(first, 403, readerCookie, method)
  expect(opened.length).toBe(beforeDenied)
  await owner.request('PATCH', base, 200, { visibility: 'public' })
  expect((await read(first, 200, '')).bytes.subarray(-40).toString()).toBe(first)
  await owner.request('POST', '/namespaces/archive-team/spaces', 201, { name: 'Objects', slug: 'objects', type: 'object' })
  await owner.request('GET', '/namespaces/archive-team/spaces/objects/git/archive', 400)
  await expect.poll(() => opened.every(content => vi.mocked(content.createReadStream).mock.results.every(result => result.type !== 'return' || result.value.destroyed))).toBe(true)
})
