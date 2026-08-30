import { describe, expect, it } from 'vitest'

import {
  NamespaceServiceError,
  normalizeNamespaceSlug,
  personalNamespaceSlug,
  validateNamespace,
  validateNamespaceMemberEmail,
  validateNamespaceSlug,
} from './namespaces.js'

describe('namespace service', () => {
  it('creates a stable personal namespace slug', () => {
    expect(
      personalNamespaceSlug('cb03c0c8-15b0-456f-accc-e03b8e6b2460'),
    ).toBe('u-cb03c0c815b0456faccce03b8e6b2460')
  })

  it('normalizes organization namespace slugs', () => {
    expect(normalizeNamespaceSlug(' Game-Team ')).toBe('game-team')
  })

  it('accepts valid organization namespaces', () => {
    expect(() => validateNamespace('Game Team', 'game-team')).not.toThrow()
  })

  it('accepts a valid namespace slug for public lookup', () => {
    expect(() => validateNamespaceSlug('game-team')).not.toThrow()
  })

  it('accepts a valid namespace member email', () => {
    expect(() => validateNamespaceMemberEmail('member@example.com')).not.toThrow()
  })

  it.each(['', 'member', '@example.com', 'member@example'])(
    'rejects invalid namespace member email %s',
    (email) => {
      expect(() => validateNamespaceMemberEmail(email)).toThrow(
        NamespaceServiceError,
      )
    },
  )

  it.each(['ab', '-game', 'game-', 'game--team', 'game_team'])(
    'rejects invalid namespace slug %s',
    (slug) => {
      expect(() => validateNamespace('Game Team', slug)).toThrow(
        NamespaceServiceError,
      )
    },
  )
})
