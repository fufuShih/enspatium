import { expect, test, vi } from 'vitest'
import { clearAppCaches, registerAppWorker, unregisterAppWorker } from '../src/pages/AppPages/pwaRuntime'

test('workers register only under their App path and bypass stale HTTP caches', async () => {
  const register = vi.fn().mockResolvedValue({})
  const container = { register } as unknown as ServiceWorkerContainer
  const base = '/app/note/first/'
  await registerAppWorker(container, base)
  expect(register).toHaveBeenCalledWith(base + 'sw.js', { scope: base, updateViaCache: 'none' })
})

test('cache cleanup matches the full App UUID prefix and never clears the origin', async () => {
  const id = '01234567-89ab-cdef-0123-456789abcdef'
  const keys = ['main', `enspatium-pwa:${id}:v1`, `enspatium-pwa:${id}:v2`, `enspatium-pwa:${id}extra:v1`, 'enspatium-pwa:other:v1']
  const remove = vi.fn(async () => true)
  const storage = { keys: async () => keys, delete: remove } as unknown as CacheStorage
  await clearAppCaches(storage, id)
  expect(remove.mock.calls).toEqual([[keys[1]], [keys[2]]])
  remove.mockClear()
  await clearAppCaches(storage, '')
  expect(remove).not.toHaveBeenCalled()
})

test('disabling an App unregisters its exact scope, not the main site or other Apps', async () => {
  const origin = 'https://app.example'
  const scopes = ['/', '/app/note/first/', '/app/note/first-other/', '/app/note/second/']
  const registrations = scopes.map(scope => ({ scope: origin + scope, unregister: vi.fn().mockResolvedValue(true) }))
  await unregisterAppWorker({ getRegistrations: async () => registrations } as unknown as ServiceWorkerContainer, origin, '/app/note/first/')
  expect(registrations.map(registration => registration.unregister.mock.calls.length)).toEqual([0, 1, 0, 0])
})
