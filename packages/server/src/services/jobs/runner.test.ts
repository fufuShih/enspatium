import type { FastifyInstance } from 'fastify'
import { afterEach, expect, test, vi } from 'vitest'
import type { Job } from '../../db/types/job.types.js'
import * as access from '../admin-users.js'
import * as handlers from './handlers.js'
import * as queue from './queue.js'
import { JobWorker } from './runner.js'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

function testApp() {
  return { db: {}, config: { DATA_ROOT: 'unused' }, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as unknown as FastifyInstance
}

const running: Job = {
  id: 'job', kind: 'storage.check', payload: { deep: false }, space_id: null,
  requested_by_user_id: 'admin', retry_of_job_id: null, status: 'running',
  result: null, error_code: null, error_message: null,
  created_at: new Date(), started_at: new Date(), finished_at: null,
}

test('startup recovery completes once before claiming; idle shutdown wakes the poll', async () => {
  vi.useFakeTimers()
  const recovery = Promise.withResolvers<bigint>()
  const recover = vi.spyOn(queue, 'recoverInterruptedJobs').mockReturnValue(recovery.promise)
  const claim = vi.spyOn(queue, 'claimNextJob').mockResolvedValue(undefined)
  const worker = new JobWorker(testApp())
  try {
    const starting = worker.start()
    expect(worker.start()).toBe(starting)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(claim).not.toHaveBeenCalled()
    recovery.resolve(1n)
    await starting
    await vi.advanceTimersByTimeAsync(0)
    expect(claim).toHaveBeenCalledTimes(1)
    await worker.start()
    expect(recover).toHaveBeenCalledTimes(1)
    await worker.close()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(claim).toHaveBeenCalledTimes(1)
  } finally { recovery.resolve(0n); await worker.close() }
})

test('closing during startup waits for recovery and never starts polling', async () => {
  const recovery = Promise.withResolvers<bigint>()
  vi.spyOn(queue, 'recoverInterruptedJobs').mockReturnValue(recovery.promise)
  const claim = vi.spyOn(queue, 'claimNextJob').mockResolvedValue(undefined)
  const worker = new JobWorker(testApp())
  const starting = worker.start()
  let stopped = false
  const closing = worker.close().then(() => { stopped = true })
  try {
    await Promise.resolve()
    expect(stopped).toBe(false)
    recovery.resolve(0n)
    await starting
    await closing
    expect(claim).not.toHaveBeenCalled()
    await worker.start()
    expect(claim).not.toHaveBeenCalled()
  } finally { recovery.resolve(0n); await worker.close() }
})

test('recovery failure fails startup and never claims work', async () => {
  const failure = new Error('Database unavailable')
  vi.spyOn(queue, 'recoverInterruptedJobs').mockRejectedValue(failure)
  const claim = vi.spyOn(queue, 'claimNextJob').mockResolvedValue(undefined)
  const worker = new JobWorker(testApp())
  await expect(worker.start()).rejects.toBe(failure)
  await expect(worker.close()).resolves.toBeUndefined()
  expect(claim).not.toHaveBeenCalled()
})

test('shutdown drains an in-flight claim, handler and persisted result without claiming another job', async () => {
  vi.useFakeTimers()
  const claimResult = Promise.withResolvers<Job>()
  const scan = Promise.withResolvers<unknown>()
  const saved = Promise.withResolvers<Job>()
  vi.spyOn(queue, 'recoverInterruptedJobs').mockResolvedValue(0n)
  const claim = vi.spyOn(queue, 'claimNextJob').mockReturnValue(claimResult.promise)
  vi.spyOn(access, 'requireSiteAdmin').mockResolvedValue(undefined)
  const handler = vi.spyOn(handlers, 'runJobHandler').mockReturnValue(scan.promise)
  const succeed = vi.spyOn(queue, 'succeedJob').mockReturnValue(saved.promise)
  const worker = new JobWorker(testApp())
  try {
    await worker.start()
    expect(claim).toHaveBeenCalledTimes(1)
    let stopped = false
    const closing = worker.close().then(() => { stopped = true })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(stopped).toBe(false)
    claimResult.resolve(running)
    await vi.advanceTimersByTimeAsync(0)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(stopped).toBe(false)
    scan.resolve({ status: 'ok' })
    await vi.advanceTimersByTimeAsync(0)
    expect(succeed).toHaveBeenCalledTimes(1)
    expect(stopped).toBe(false)
    saved.resolve({ ...running, status: 'succeeded' })
    await closing
    await vi.advanceTimersByTimeAsync(10_000)
    expect(claim).toHaveBeenCalledTimes(1)
  } finally {
    claimResult.resolve(running); scan.resolve({}); saved.resolve(running)
    await worker.close()
  }
})
