import { expect, test } from 'vitest'
import { validateProductionConfig } from './config.js'

test('production refuses insecure session cookies and the published example key', () => {
  const config = { NODE_ENV: 'production' as const, SESSION_SECURE: true, SESSION_KEY: 'ab'.repeat(32) }
  expect(() => validateProductionConfig(config)).not.toThrow()
  expect(() => validateProductionConfig({ ...config, SESSION_SECURE: false })).toThrow('SESSION_SECURE')
  expect(() => validateProductionConfig({ ...config, SESSION_KEY: '0123456789abcdef'.repeat(4) })).toThrow('SESSION_KEY')
  expect(() => validateProductionConfig({ ...config, NODE_ENV: 'development', SESSION_SECURE: false })).not.toThrow()
})
