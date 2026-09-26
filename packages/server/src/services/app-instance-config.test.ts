import { afterEach, describe, expect, it, vi } from 'vitest'
import { Type } from '@sinclair/typebox'
import * as plugins from '../apps/registry.js'
import { validateAppInstanceConfig, validateAppInstanceName } from './app-instance-config.js'

afterEach(() => vi.restoreAllMocks())

describe('App instance configuration', () => {
  it('normalizes names and rejects empty or oversized names', () => {
    expect(validateAppInstanceName('  Library  ')).toBe('Library')
    expect(validateAppInstanceName('a'.repeat(100))).toHaveLength(100)
    for (const name of ['', '  ', 'a'.repeat(101)]) {
      expect(() => validateAppInstanceName(name)).toThrow('between 1 and 100')
    }
  })

  it('accepts only empty config when no plugin schema is deployed', () => {
    for (const type of ['media', 'ebook', 'note', 'custom-metadata-only']) {
      expect(validateAppInstanceConfig(type, {})).toEqual({})
      expect(() => validateAppInstanceConfig(type, { arbitrary: true })).toThrow('plugin schema')
    }
  })

  it('validates and copies config using the deployed plugin schema without coercion', () => {
    vi.spyOn(plugins, 'getObjectAppPlugin').mockReturnValue({
      type: 'configured', storageType: 'object', kinds: [],
      configSchema: Type.Object({ columns: Type.Integer({ minimum: 1, maximum: 4 }) }, { additionalProperties: false }),
    })
    const value = { columns: 2 }
    expect(validateAppInstanceConfig('configured', value)).toEqual(value)
    expect(validateAppInstanceConfig('configured', value)).not.toBe(value)
    for (const config of [{}, { columns: '2' }, { columns: 5 }, { columns: 2, extra: true }]) {
      expect(() => validateAppInstanceConfig('configured', config)).toThrow('plugin schema')
    }
  })

  it('bounds JSON size and nesting and rejects non-JSON or cyclic values', () => {
    vi.spyOn(plugins, 'getObjectAppPlugin').mockReturnValue({
      type: 'configured', storageType: 'object', kinds: [], configSchema: Type.Object({}),
    })
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    let deep: unknown = {}
    for (let i = 0; i < 22; i++) deep = { child: deep }
    for (const config of [null, [], true, { value: undefined }, { value: NaN }, { value: Infinity },
      { value: BigInt(1) }, { value: () => null }, { value: new Date() }, { value: Array(1) }, cyclic, deep]) {
      expect(() => validateAppInstanceConfig('configured', config)).toThrow('JSON object')
    }
    expect(() => validateAppInstanceConfig('configured', { text: '中'.repeat(6000) })).toThrow('16 KiB')
    expect(validateAppInstanceConfig('configured', { values: [null, true, 2, 'text'] })).toEqual({ values: [null, true, 2, 'text'] })
  })
})
