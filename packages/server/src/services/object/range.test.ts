import { describe, expect, it } from 'vitest'
import { resolveObjectRange } from './range.js'

describe('single byte ranges', () => {
  it.each([
    ['bytes=0-0', 0, 0], ['bytes=2-5', 2, 5], ['bytes=7-', 7, 9],
    ['bytes=-3', 7, 9], ['bytes=-99', 0, 9], ['bytes=8-99', 8, 9],
    ['BYTES=00-02', 0, 2], ['bytes=1-99999999999999999999999', 1, 9],
    ['bytes=-99999999999999999999999', 0, 9],
  ])('resolves %s', (range, start, end) => {
    expect(resolveObjectRange(10, range)).toEqual({ kind: 'partial', start, end })
  })

  it.each(['bytes=10-', 'bytes=10-20', 'bytes=-0', 'bytes=99999999999999999999999-'])('rejects unsatisfiable %s', range => {
    expect(resolveObjectRange(10, range)).toEqual({ kind: 'unsatisfiable' })
  })

  it.each([undefined, '', 'items=0-1', 'bytes=', 'bytes=-', 'bytes=5-2', 'bytes=1.5-2', 'bytes=+1-2', 'bytes=1-2,4-5', 'bytes=1 - 2'])('ignores unsupported or malformed %s', range => {
    expect(resolveObjectRange(10, range)).toEqual({ kind: 'full' })
  })

  it('handles an empty representation', () => {
    expect(resolveObjectRange(0)).toEqual({ kind: 'full' })
    for (const range of ['bytes=0-', 'bytes=0-0', 'bytes=-1']) {
      expect(resolveObjectRange(0, range)).toEqual({ kind: 'unsatisfiable' })
    }
  })

  it('requires an exact strong ETag for If-Range; a failed condition ignores even an unsatisfiable range', () => {
    const etag = '"checksum"'
    expect(resolveObjectRange(10, 'bytes=0-1', etag, etag)).toEqual({ kind: 'partial', start: 0, end: 1 })
    for (const validator of ['"old"', 'W/"checksum"', '*', '', 'Thu, 10 Sep 2026 00:00:00 GMT']) {
      expect(resolveObjectRange(10, 'bytes=0-1', validator, etag)).toEqual({ kind: 'full' })
      expect(resolveObjectRange(10, 'bytes=99-', validator, etag)).toEqual({ kind: 'full' })
    }
  })
})
