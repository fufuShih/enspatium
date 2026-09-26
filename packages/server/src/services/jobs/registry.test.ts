import { expect, test } from 'vitest'

import {
  isJobKind,
  JobValidationError,
  maximumJobResultBytes,
  validateJobPayload,
  validateJobResult,
} from './registry.js'

test('storage.check payloads are normalized and reject unknown or invalid input', () => {
  expect(isJobKind('storage.check')).toBe(true)
  expect(isJobKind('shell')).toBe(false)
  expect(validateJobPayload('storage.check', {})).toEqual({ deep: false })
  expect(validateJobPayload('storage.check', {
    deep: true,
    spaceId: '5f58a9d4-e2a0-4bf8-9dbc-51858506923f',
  })).toEqual({ deep: true, spaceId: '5f58a9d4-e2a0-4bf8-9dbc-51858506923f' })
  for (const input of [null, [], { deep: 'yes' }, { spaceId: 'not-a-uuid' }, { command: 'whoami' }]) {
    expect(() => validateJobPayload('storage.check', input)).toThrow(JobValidationError)
  }
})

test('job results must be bounded JSON objects', () => {
  expect(validateJobResult({ status: 'ok', counts: [1, 2] })).toEqual({ status: 'ok', counts: [1, 2] })
  expect(() => validateJobResult([])).toThrow(JobValidationError)
  expect(() => validateJobResult({ report: 'x'.repeat(maximumJobResultBytes) })).toThrow('job result is too large')
  const circular: Record<string, unknown> = {}
  circular.self = circular
  expect(() => validateJobResult(circular)).toThrow('job result must be JSON serializable')
})
