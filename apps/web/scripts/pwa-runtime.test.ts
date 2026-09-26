import { expect, test, vi } from 'vitest'
import { registerAppWorker, unregisterAppWorker } from '../src/pages/AppPages/pwaRuntime'

test('workers register only under their App path and bypass stale HTTP caches', async () => {
  const register = vi.fn().mockResolvedValue({})
  const container = { register } as unknown as ServiceWorkerContainer
  const base = '/app/note/first/'
  await registerAppWorker(container, base)
  expect(register).toHaveBeenCalledWith(base + 'sw.js', { scope: base, updateViaCache: 'none' })
})

test('disabling an App unregisters its exact scope, not the main site or other Apps', async () => {
  const origin = 'https://app.example'
  const scopes = ['/', '/app/note/first/', '/app/note/first-other/', '/app/note/second/']
  const registrations = scopes.map(scope => ({ scope: origin + scope, unregister: vi.fn().mockResolvedValue(true) }))
  await unregisterAppWorker({ getRegistrations: async () => registrations } as unknown as ServiceWorkerContainer, origin, '/app/note/first/')
  expect(registrations.map(registration => registration.unregister.mock.calls.length)).toEqual([0, 1, 0, 0])
})
