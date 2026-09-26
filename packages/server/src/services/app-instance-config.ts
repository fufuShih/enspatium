import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { getObjectAppPlugin } from '../apps/registry.js'
import type { AppConfig } from '../db/types/app.types.js'
import { SpaceServiceError } from './space/space.js'

const emptyConfigSchema = Type.Object({}, { additionalProperties: false })

export function validateAppInstanceName(value: string): string {
  const name = value.trim()
  if (name.length < 1 || name.length > 100) {
    throw new SpaceServiceError('INVALID_INPUT', 400, 'App name must contain between 1 and 100 characters.')
  }
  return name
}

export function validateAppInstanceConfig(appType: string, value: unknown): AppConfig {
  // Round-trip only JSON values: no coercion, executable values or lossy serialization.
  const ancestors = new Set<object>()
  function checkJson(item: unknown, depth: number): boolean {
    if (depth > 20) return false
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return true
    if (typeof item === 'number') return Number.isFinite(item)
    if (typeof item !== 'object' || ancestors.has(item)) return false
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) return false
    if (Object.getOwnPropertySymbols(item).length) return false
    if (Array.isArray(item) && Object.keys(item).length !== item.length) return false
    ancestors.add(item)
    const valid = Object.values(item).every(child => checkJson(child, depth + 1))
    ancestors.delete(item)
    return valid
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !checkJson(value, 0)) {
    throw new SpaceServiceError('INVALID_INPUT', 400, 'App config must be a JSON object.')
  }
  const json = JSON.stringify(value)
  if (Buffer.byteLength(json, 'utf8') > 16384) {
    throw new SpaceServiceError('INVALID_INPUT', 400, 'App config exceeds 16 KiB.')
  }
  const config = JSON.parse(json) as AppConfig
  const schema = getObjectAppPlugin(appType)?.configSchema ?? emptyConfigSchema
  if (!Value.Check(schema, config)) {
    throw new SpaceServiceError('INVALID_INPUT', 400, 'App config does not match the plugin schema.')
  }
  return config
}
