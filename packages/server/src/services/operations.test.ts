import type { FastifyRequest } from 'fastify'
import { afterEach, expect, test, vi } from 'vitest'
import { OperationsMonitor } from './operations.js'

afterEach(() => vi.useRealTimers())

test('keeps bounded summaries, deduplicates transport failures and expires error alerts', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  const log = vi.fn()
  const monitor = new OperationsMonitor(async () => ({ databaseReady: true, storage: { available: true, freeBytes: 200, minimumFreeBytes: 100 } }), log)
  const request = { routeOptions: { url: '/git/:namespace/:space' } } as FastifyRequest
  monitor.recordRequest(request, 502, 'git')
  monitor.recordRequest(request, 502)
  expect((await monitor.refresh()).errors.total).toBe(1)
  for (let i = 0; i < 25; i++) monitor.recordCleanupFailure()
  const status = await monitor.refresh()
  expect(status.errors.total).toBe(26)
  expect(status.errors.recent).toHaveLength(20)
  expect(status.alerts).toEqual(['recent-server-errors'])
  expect(log).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(15 * 60 * 1000)
  expect((await monitor.refresh()).status).toBe('ok')
  expect(log).toHaveBeenLastCalledWith([])
})

test('shares concurrent probes and reports recovery without repeating unchanged warnings', async () => {
  let finish!: (result: { databaseReady: boolean; storage: { available: boolean; freeBytes: number; minimumFreeBytes: number } }) => void
  const probe = vi.fn(() => new Promise<Parameters<typeof finish>[0]>(resolve => { finish = resolve }))
  const log = vi.fn()
  const monitor = new OperationsMonitor(probe, log)
  const first = monitor.refresh()
  const second = monitor.refresh()
  expect(probe).toHaveBeenCalledTimes(1)
  finish({ databaseReady: false, storage: { available: true, freeBytes: 5, minimumFreeBytes: 10 } })
  expect((await first).alerts).toEqual(['database-unavailable', 'low-disk-space'])
  expect(await second).toEqual(await first)
  expect(log).toHaveBeenCalledTimes(1)
  const next = monitor.refresh()
  finish({ databaseReady: true, storage: { available: true, freeBytes: 50, minimumFreeBytes: 10 } })
  expect((await next).status).toBe('ok')
  expect(log).toHaveBeenLastCalledWith([])
})
