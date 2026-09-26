import { createHash, webcrypto } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import { expect, test, vi } from 'vitest'
import { pwaCachePrefix, pwaWorker, validatePwaShell, type PwaShell } from './pwa-worker.js'

const id = '01234567-89ab-cdef-0123-456789abcdef'
const other = '11234567-89ab-cdef-0123-456789abcdef'
const origin = 'https://example.test'
const base = `/app/note/${id}/`
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const shell: PwaShell = { build: hash('build 1'), html: hash('<html>Offline</html>'), assets: [
  { url: '/assets/offline-123abc.js', sha256: hash('/* offline */'), type: 'javascript' },
  { url: '/assets/offline-456abc.css', sha256: hash('body{}'), type: 'text/css' },
] }
type Store = Map<string, Map<string, Response>>
type WorkerEvent = { waitUntil?: (promise: Promise<unknown>) => void; request?: unknown; respondWith?: (response: Promise<Response>) => void; data?: string; ports?: unknown[] }

function worker(build: PwaShell | null = shell, store: Store = new Map(), appId = id) {
  const absolute = (input: string | Request) => new URL(typeof input === 'string' ? input : input.url, origin).href
  const handlers = new Map<string, (event: WorkerEvent) => void>()
  const fetch = vi.fn(async (input: string | Request, _options?: RequestInit) => {
    const url = absolute(input)
    if (url.includes('offline.html')) return new Response('<html>Offline</html>', { headers: { 'content-type': 'text/html' } })
    if (url.endsWith('.css')) return new Response('body{}', { headers: { 'content-type': 'text/css' } })
    if (url.endsWith('.js')) return new Response('/* offline */', { headers: { 'content-type': 'application/javascript' } })
    return new Response('Authorized network content')
  })
  const caches = {
    keys: async () => [...store.keys()],
    delete: vi.fn(async (key: string) => store.delete(key)),
    open: async (key: string) => {
      if (!store.has(key)) store.set(key, new Map())
      return { put: async (input: string, response: Response) => { store.get(key)!.set(absolute(input), response.clone()) } }
    },
    match: async (input: string | Request, options: { cacheName: string }) => store.get(options.cacheName)?.get(absolute(input))?.clone(),
  }
  const claim = vi.fn(async () => {})
  const unregister = vi.fn(async () => true)
  const skipWaiting = vi.fn(async () => {})
  runInNewContext(pwaWorker('note', appId, build), { caches, fetch, URL, Response, AbortSignal, crypto: webcrypto, self: {
    location: { origin }, clients: { claim }, registration: { unregister }, skipWaiting,
    addEventListener: (type: string, handler: (event: WorkerEvent) => void) => handlers.set(type, handler),
  } })
  async function lifecycle(type: string) {
    let done: Promise<unknown> | undefined
    handlers.get(type)?.({ waitUntil: promise => { done = promise } })
    await done
  }
  function request(path: string, { method = 'GET', mode = 'navigate', headers = {} }: { method?: string; mode?: string; headers?: Record<string, string> } = {}) {
    let response: Promise<Response> | undefined
    handlers.get('fetch')?.({ request: { url: new URL(path, origin).href, method, mode, headers: new Headers(headers) }, respondWith: promise => { response = promise } })
    return response
  }
  return { store, fetch, caches, claim, unregister, skipWaiting, lifecycle, request, handlers }
}

test('shell allowlist rejects paths, dynamic content, duplicate entries and invalid digests', () => {
  expect(validatePwaShell(shell)).toEqual(shell)
  for (const url of ['/api/auth/session', '/assets/../secret.js', 'https://evil.test/assets/a-b.js', '/assets/main.js?user=1', '/assets/user.svg', '/assets/main.js']) {
    expect(() => validatePwaShell({ ...shell, assets: [{ ...shell.assets[0], url }] })).toThrow()
  }
  for (const value of [null, {}, { ...shell, build: '../old' }, { ...shell, assets: [] }, { ...shell, assets: [...shell.assets, shell.assets[0]] }, { ...shell, assets: [{ ...shell.assets[0], sha256: 'bad' }] }]) expect(() => validatePwaShell(value)).toThrow()
  expect(() => pwaWorker('note', '../escape', shell)).toThrow()
})

test('installation stores only integrity-checked shell bytes, without credentials or redirects', async () => {
  const sw = worker()
  await sw.lifecycle('install')
  expect(sw.fetch).toHaveBeenCalledTimes(3)
  for (const call of sw.fetch.mock.calls) expect(call[1]).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal) })
  expect([...sw.store.keys()]).toEqual([pwaCachePrefix(id) + shell.build])
  expect([...sw.store.values()][0]!.size).toBe(3)
  expect(sw.skipWaiting).toHaveBeenCalledOnce()
  await sw.lifecycle('activate')
  expect(sw.claim).toHaveBeenCalledOnce()
})

test.each(['hash', 'mime', 'status', 'network'])('failed %s verification preserves the active build and never activates a partial cache', async failure => {
  const old = worker()
  await old.lifecycle('install')
  const next = worker({ ...shell, build: hash('build 2') }, old.store)
  if (failure === 'network') next.fetch.mockRejectedValue(new Error('offline'))
  else next.fetch.mockResolvedValue(new Response(failure === 'hash' ? 'Private login HTML' : '<html>Offline</html>', { status: failure === 'status' ? 503 : 200, headers: { 'content-type': failure === 'mime' ? 'application/json' : 'text/html' } }))
  await expect(next.lifecycle('install')).rejects.toThrow()
  expect(next.skipWaiting).not.toHaveBeenCalled()
  expect([...old.store.keys()]).toEqual([pwaCachePrefix(id) + shell.build])
})

test('updates and disable clean only this exact App prefix, including two Apps of the same type', async () => {
  const first = worker()
  await first.lifecycle('install')
  await worker(shell, first.store, other).lifecycle('install')
  first.store.set('some-other-site-cache', new Map())
  const next = worker({ ...shell, build: hash('build 2') }, first.store)
  await next.lifecycle('install')
  await next.lifecycle('activate')
  expect([...first.store.keys()].sort()).toEqual([pwaCachePrefix(id) + hash('build 2'), pwaCachePrefix(other) + shell.build, 'some-other-site-cache'].sort())
  const cleanup = worker(null, first.store)
  await cleanup.lifecycle('install')
  await cleanup.lifecycle('activate')
  expect(cleanup.unregister).toHaveBeenCalledOnce()
  expect(cleanup.handlers.has('fetch')).toBe(false)
  expect([...first.store.keys()].sort()).toEqual([pwaCachePrefix(other) + shell.build, 'some-other-site-cache'].sort())
})

test('an active worker repairs evicted shell caches, coalesces retries and reports failed setup without caching content', async () => {
  const sw = worker()
  await sw.lifecycle('install')
  sw.store.clear(); sw.fetch.mockClear()
  async function message(data: string) {
    const reply = vi.fn()
    let done: Promise<unknown> | undefined
    sw.handlers.get('message')!({ data, ports: [{ postMessage: reply }], waitUntil: promise => { done = promise } })
    await done
    return reply.mock.calls[0]?.[0]
  }
  expect(await message('PWA_STATUS')).toMatchObject({ ready: false })
  const results = await Promise.all([message('PWA_PREPARE'), message('PWA_PREPARE')])
  expect(results).toEqual([{ ready: true, build: shell.build }, { ready: true, build: shell.build }])
  expect(sw.fetch).toHaveBeenCalledTimes(3)
  await message('PWA_PREPARE')
  expect(sw.fetch).toHaveBeenCalledTimes(3)
  sw.store.clear(); sw.fetch.mockRejectedValue(new Error('offline'))
  expect(await message('PWA_PREPARE')).toMatchObject({ ready: false })
  expect(sw.store.size).toBe(0)
})

test('offline navigation uses generic shell, never stores online/private HTML or replaces HTTP errors', async () => {
  const sw = worker()
  await sw.lifecycle('install')
  const keys = [...sw.store.values()][0]!.size
  expect(await (await sw.request(base + 'note/private-id'))!.text()).toBe('Authorized network content')
  for (const status of [401, 403, 404, 500, 503]) {
    sw.fetch.mockResolvedValueOnce(new Response('Not available', { status }))
    expect((await sw.request(base))!.status).toBe(status)
  }
  sw.fetch.mockRejectedValue(new Error('offline'))
  expect(await (await sw.request(base + 'note/private-id?search=secret'))!.text()).toBe('<html>Offline</html>')
  expect([...sw.store.values()][0]!.size).toBe(keys)
  expect([...sw.store.values()][0]!.keys()).not.toContain(origin + base)
})

test('private APIs, Git, Objects, login, other origins/Apps, methods, Range and authorization bypass interception', async () => {
  const sw = worker()
  await sw.lifecycle('install')
  sw.fetch.mockClear()
  for (const path of ['/api/auth/session', '/api/apps/note/instances/' + id + '/content?key=secret', '/api/namespaces/me/spaces/secret/git/raw', '/api/namespaces/me/spaces/secret/objects/file', '/login', '/settings', `/app/note/${other}/`, 'https://other.test' + base, base + 'sw.js', base + 'manifest.webmanifest', base + 'icon-192.png']) expect(sw.request(path)).toBeUndefined()
  for (const method of ['HEAD', 'POST', 'PUT', 'DELETE', 'PATCH']) expect(sw.request(base, { method })).toBeUndefined()
  for (const headers of [{ range: 'bytes=0-9' }, { authorization: 'Bearer secret' }]) {
    expect(sw.request(base, { headers })).toBeUndefined()
    expect(sw.request(shell.assets[0]!.url, { mode: 'cors', headers })).toBeUndefined()
  }
  expect(sw.request(base + 'objects', { mode: 'cors' })).toBeUndefined()
  expect(sw.request(shell.assets[0]!.url + '?secret=1', { mode: 'cors' })).toBeUndefined()
  expect(sw.fetch).not.toHaveBeenCalled()
  expect(await (await sw.request(shell.assets[0]!.url, { mode: 'cors' }))!.text()).toBe('/* offline */')
  expect(sw.fetch).not.toHaveBeenCalled()
})
