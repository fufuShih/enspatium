import { describe, expect, it } from 'vitest'

import {
  AuditServiceError,
  defaultAuditEventLimit,
  maximumAuditEventLimit,
  normalizeAuditEventLimit,
} from './audit.js'

describe('normalizeAuditEventLimit', () => {
  it('uses the default when no limit is provided', () => {
    expect(normalizeAuditEventLimit()).toBe(defaultAuditEventLimit)
  })

  it('accepts the supported boundaries', () => {
    expect(normalizeAuditEventLimit(1)).toBe(1)
    expect(normalizeAuditEventLimit(maximumAuditEventLimit)).toBe(
      maximumAuditEventLimit,
    )
  })

  it.each([0, -1, 1.5, maximumAuditEventLimit + 1])(
    'rejects an invalid limit: %s',
    (limit) => {
      expect(() => normalizeAuditEventLimit(limit)).toThrow(
        AuditServiceError,
      )
    },
  )
})
