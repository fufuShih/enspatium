import { test, expect, vi } from 'vitest'
import { request as httpRequest } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createFixture } from './fixture.js'
import type { PublicSpace } from '../src/db/space.types.js'
import type { PublicUser } from '../src/db/user.types.js'
import * as repository from '../src/services/git/repository.js'

test('Git raw streams preserve bytes and revisions, check access, and stop on disconnect', async ({ onTestFinished }) => {
  const { origin, root, session, git } = await createFixture({ after: cleanup => onTestFinished(cleanup), diagnostic: message => console.info(message) })
  const owner = session()
  const member = session()
  const password = 'Git-files-1234'
  const credentials = { email: 'git-files@example.com', password }
  await owner.request('POST', '/users', 201, { ...credentials, displayName: 'Owner' })
  const reader = await member.request<PublicUser>('POST', '/users', 201, { email: 'git-reader@example.com', password, displayName: 'Reader' })
  await owner.request('POST', '/auth/login', 200, credentials)
  await member.request('POST', '/auth/login', 200, { email: reader.email, password })
  async function cookieFor(email: string) {
    const response = await fetch(origin + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })
    expect(response.status).toBe(200)
    await response.arrayBuffer()
    return response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  }
  const cookie = await cookieFor(credentials.email)
  const memberCookie = await cookieFor(reader.email)
  await owner.request('POST', '/namespaces', 201, { name: 'Git files', slug: 'git-files' })
  const base = '/namespaces/git-files/spaces/files'
  const space = await owner.request<PublicSpace>('POST', '/namespaces/git-files/spaces', 201, { name: 'Files', slug: 'files', type: 'git' })
  await owner.request('POST', '/namespaces/git-files/members', 201, { email: reader.email })
  await owner.request('POST', base + '/members', 201, { email: reader.email, role: 'reader' })
  const source = join(root, 'git-files-source')
  await git(['clone', join(root, 'data', space.id), source])
  const run = (args: string[]) => git(['-C', source, ...args])
  await run(['config', 'core.autocrlf', 'false'])
  await mkdir(join(source, 'docs'))
  const name = "中文 #'().html"
  const text = Buffer.from('<script>globalThis.executed = true</script>\r\nRaw bytes\n')
  const binary = Buffer.from([0, 1, 0, 127, 128, 255])
  const large = Buffer.alloc(8 * 1024 * 1024, 42)
  await writeFile(join(source, 'docs', name), text)
  await writeFile(join(source, 'binary.bin'), binary)
  await writeFile(join(source, 'large.bin'), large)
  await writeFile(join(source, 'empty.txt'), '')
  await writeFile(join(source, 'link.txt'), '../outside-secret')
  await run(['add', '.'])
  const linkBlob = (await run(['hash-object', 'link.txt'])).stdout.trim()
  await run(['update-index', '--cacheinfo', `120000,${linkBlob},link.txt`])
  await run(['commit', '-m', 'Files'])
  await run(['push', 'origin', 'HEAD:main'])
  const first = (await run(['rev-parse', 'HEAD'])).stdout.trim()
  await run(['tag', 'first'])
  await run(['push', 'origin', '--tags'])
  const raw = (path: string, ref = first, download = false) => base + '/git/raw?' + new URLSearchParams({ ref, path, download: String(download) })
  async function read(url: string, status = 200, auth = cookie, method = 'GET') {
    const response = await fetch(origin + url, { method, headers: auth ? { cookie: auth } : {}, signal: AbortSignal.timeout(15_000) })
    const bytes = Buffer.from(await response.arrayBuffer())
    expect(response.status).toBe(status)
    return { response, bytes }
  }
  const html = await read(raw('docs/' + name), 200, memberCookie)
  expect(html.bytes).toEqual(text)
  expect(html.response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
  expect(html.response.headers.get('x-content-type-options')).toBe('nosniff')
  expect(html.response.headers.get('content-security-policy')).toContain('sandbox')
  expect(html.response.headers.get('cache-control')).toBe('private, no-store')
  expect(html.response.headers.get('x-git-commit')).toBe(first)
  const download = await read(raw('docs/' + name, first, true))
  expect(download.bytes).toEqual(text)
  expect(download.response.headers.get('content-type')).toBe('application/octet-stream')
  expect(download.response.headers.get('content-disposition')).toContain('attachment;')
  expect(decodeURIComponent(download.response.headers.get('content-disposition')!.split("filename*=UTF-8''")[1]!)).toBe(name)
  expect((await read(raw('binary.bin'))).bytes).toEqual(binary)
  expect((await read(raw('empty.txt'))).bytes.length).toBe(0)
  expect((await read(raw('link.txt'))).bytes.toString()).toBe('../outside-secret')
  expect((await read(raw('large.bin'))).bytes.equals(large)).toBe(true)
  await owner.request('GET', base + '/git/file?path=large.bin', 413)
  expect(await owner.request<repository.GitFileInfo>('GET', base + '/git/file-info?path=large.bin')).toMatchObject({ size: large.length, commitId: first })
  expect(await owner.request<repository.GitFile>('GET', base + '/git/file?path=binary.bin')).toMatchObject({ encoding: 'base64' })

  // HEAD never spawns cat-file; aborted GET closes its streaming source.
  const realOpen = repository.openGitFile
  const opened: Awaited<ReturnType<typeof realOpen>>[] = []
  vi.spyOn(repository, 'openGitFile').mockImplementation(async (...args) => {
    const result = await realOpen(...args)
    vi.spyOn(result, 'createReadStream')
    opened.push(result)
    return result
  })
  onTestFinished(() => { vi.restoreAllMocks() })
  const head = await read(raw('large.bin'), 200, memberCookie, 'HEAD')
  expect(head.bytes.length).toBe(0)
  expect(head.response.headers.get('content-length')).toBe(String(large.length))
  expect(opened.at(-1)!.createReadStream).not.toHaveBeenCalled()
  await new Promise<void>((resolve, reject) => {
    const request = httpRequest(origin + raw('large.bin'), { headers: { cookie } }, response => {
      expect(response.statusCode).toBe(200)
      response.once('data', () => { response.destroy(); resolve() })
      response.once('error', reject)
    })
    request.setTimeout(10_000, () => request.destroy(new Error('Streaming timeout')))
    request.once('error', reject)
    request.end()
  })
  const stream = vi.mocked(opened.at(-1)!.createReadStream).mock.results[0]!.value
  await expect.poll(() => stream.destroyed).toBe(true)

  // A later commit changes the branch, not a pinned download or tag.
  await writeFile(join(source, 'docs', name), 'Updated')
  await run(['add', 'docs'])
  await run(['update-index', '--add', '--cacheinfo', `160000,${first},module`])
  await run(['commit', '-m', 'Update'])
  await run(['push', 'origin', 'HEAD:main'])
  expect((await read(raw('docs/' + name, 'main'))).bytes.toString()).toBe('Updated')
  expect((await read(raw('docs/' + name, first))).bytes).toEqual(text)
  expect((await read(raw('docs/' + name, 'refs/tags/first'))).bytes).toEqual(text)
  for (const [path, ref, status] of [['../secret', 'main', 400], ['/config', 'main', 400], ['docs', 'main', 400], ['module', 'main', 400], ['missing', 'main', 404], ['binary.bin', '--all', 404], ['binary.bin', 'missing', 404]] as const) {
    await read(raw(path, ref), status)
  }
  for (const method of ['GET', 'HEAD']) await read(raw('binary.bin'), 401, '', method)
  await owner.request('DELETE', base + '/members/' + reader.id, 204)
  const beforeDenied = opened.length
  for (const method of ['GET', 'HEAD']) await read(raw('binary.bin'), 403, memberCookie, method)
  await member.request('GET', base + '/git/file-info?path=binary.bin', 403)
  expect(opened.length).toBe(beforeDenied)
  await owner.request('PATCH', base, 200, { visibility: 'public' })
  expect((await read(raw('binary.bin'), 200, '')).bytes).toEqual(binary)
  // HTTP Content-Length can finish the client before Git exits. Wait for all
  // content sources to close before shutting down the fixture's HTTP server.
  await expect.poll(() => opened.every(content => vi.mocked(content.createReadStream).mock.results.every(result => result.type !== 'return' || result.value.destroyed))).toBe(true)
})
