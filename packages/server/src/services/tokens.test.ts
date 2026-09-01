import { describe, expect, it } from 'vitest'

import type { CreatePersonalAccessTokenInput } from '../db/token.types.js'
import {
  TokenServiceError,
  generatePersonalAccessToken,
  hashPersonalAccessToken,
  validateCreatePersonalAccessToken,
} from './tokens.js'

describe('personal access token service', () => {
  it('generates random tokens with the Enspatium prefix', () => {
    const firstToken = generatePersonalAccessToken()
    const secondToken = generatePersonalAccessToken()

    expect(firstToken).toMatch(/^ensp_[A-Za-z0-9_-]{43}$/)
    expect(secondToken).toMatch(/^ensp_[A-Za-z0-9_-]{43}$/)
    expect(firstToken).not.toBe(secondToken)
  })

  it('hashes tokens with SHA-256', () => {
    const token = 'ensp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ'
    const firstHash = hashPersonalAccessToken(token)

    expect(firstHash).toMatch(/^[0-9a-f]{64}$/)
    expect(hashPersonalAccessToken(token)).toBe(firstHash)
    expect(firstHash).not.toContain(token)
  })

  it('normalizes valid token input', () => {
    const input = validateCreatePersonalAccessToken({
      name: '  Git on laptop  ',
      scopes: ['git:read', 'git:write'],
      expiresAt: '2100-01-01T00:00:00.000Z',
    })

    expect(input).toEqual({
      name: 'Git on laptop',
      scopes: ['git:read', 'git:write'],
      expiresAt: new Date('2100-01-01T00:00:00.000Z'),
    })
  })

  it.each([
    {
      name: '',
      scopes: ['git:read'],
    },
    {
      name: 'Duplicate scopes',
      scopes: ['git:read', 'git:read'],
    },
    {
      name: 'Unknown scope',
      scopes: ['admin'],
    },
    {
      name: 'Expired token',
      scopes: ['git:read'],
      expiresAt: '2000-01-01T00:00:00.000Z',
    },
  ])('rejects invalid token input', (input) => {
    expect(() =>
      validateCreatePersonalAccessToken(
        input as CreatePersonalAccessTokenInput,
      ),
    ).toThrow(TokenServiceError)
  })
})
