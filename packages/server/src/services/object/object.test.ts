import { describe, expect, it } from 'vitest'

import {
  calculateObjectStorageUsage,
  defaultObjectListLimit,
  ensureObjectQuota,
  maximumObjectListLimit,
  normalizeObjectListLimit,
  ObjectServiceError,
  parseContentLength,
} from './object.js'

describe('parseContentLength', () => {
  it('accepts an absent or valid content length', () => {
    expect(parseContentLength()).toBeUndefined()
    expect(parseContentLength('0')).toBe(0)
    expect(parseContentLength('1024')).toBe(1024)
  })

  it.each(['-1', '1.5', 'abc', '9007199254740992'])(
    'rejects an invalid content length: %s',
    (contentLength) => {
      expect(() => parseContentLength(contentLength)).toThrow(
        ObjectServiceError,
      )
    },
  )
})

describe('Object storage quota', () => {
  it('calculates used, quota, and remaining bytes from PostgreSQL values', () => {
    expect(calculateObjectStorageUsage('256', '1024')).toEqual({
      usedBytes: 256,
      quotaBytes: 1024,
      remainingBytes: 768,
    })
  })

  it('accepts an object that exactly fills the remaining quota', () => {
    expect(() =>
      ensureObjectQuota(
        { usedBytes: 768, quotaBytes: 1024, remainingBytes: 256 },
        256,
      ),
    ).not.toThrow()
  })

  it('rejects an object larger than the remaining quota', () => {
    expect(() =>
      ensureObjectQuota(
        { usedBytes: 768, quotaBytes: 1024, remainingBytes: 256 },
        257,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'QUOTA_EXCEEDED',
        statusCode: 413,
      }),
    )
  })
})

describe('normalizeObjectListLimit', () => {
  it('uses the default and accepts supported boundaries', () => {
    expect(normalizeObjectListLimit()).toBe(defaultObjectListLimit)
    expect(normalizeObjectListLimit(1)).toBe(1)
    expect(normalizeObjectListLimit(maximumObjectListLimit)).toBe(
      maximumObjectListLimit,
    )
  })

  it.each([0, -1, 1.5, maximumObjectListLimit + 1])(
    'rejects an invalid limit: %s',
    (limit) => {
      expect(() => normalizeObjectListLimit(limit)).toThrow(
        ObjectServiceError,
      )
    },
  )
})
