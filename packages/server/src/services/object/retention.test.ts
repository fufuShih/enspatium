import { expect, test, vi } from 'vitest'
import { startObjectCleanupLoop } from './retention.js'

test('retention runs on startup, never overlaps, and stops before closing dependencies', async () => {
  vi.useFakeTimers()
  let finish!: () => void
  const run = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const onError = vi.fn()
  const stop = startObjectCleanupLoop(run, onError, 60_000)
  try {
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(180_000)
    expect(run).toHaveBeenCalledTimes(1)
    finish()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(run).toHaveBeenCalledTimes(2)
    let closed = false
    const closing = stop().then(() => { closed = true })
    await Promise.resolve()
    expect(closed).toBe(false)
    finish()
    await closing
    await vi.advanceTimersByTimeAsync(60_000)
    expect(run).toHaveBeenCalledTimes(2)
    expect(onError).not.toHaveBeenCalled()
  } finally { finish(); await stop(); vi.useRealTimers() }
})

test('failed cleanup is reported and the next sweep still runs', async () => {
  vi.useFakeTimers()
  const failure = new Error('database unavailable')
  const run = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined)
  const onError = vi.fn()
  const stop = startObjectCleanupLoop(run, onError, 60_000)
  try {
    await vi.advanceTimersByTimeAsync(60_000)
    expect(onError).toHaveBeenCalledWith(failure)
    expect(run).toHaveBeenCalledTimes(2)
  } finally { await stop(); vi.useRealTimers() }
})
