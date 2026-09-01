import { describe, expect, it } from 'vitest'

import {
  SpaceServiceError,
  normalizeSpaceSlug,
  validateGitWriteRole,
  validateAssignableSpaceMemberRole,
  validateSpace,
  validateSpaceMemberEmail,
  validateSpaceUpdate,
} from './space.js'

describe('Space service', () => {
  it('normalizes space slugs', () => {
    expect(normalizeSpaceSlug(' My-Repository ')).toBe('my-repository')
  })

  it('accepts a valid space', () => {
    expect(() =>
      validateSpace('My Repository', 'my-repository', 'git', 'private'),
    ).not.toThrow()
  })

  it.each(['ab', '-repo', 'repo-', 'my--repo', 'my_repo'])(
    'rejects invalid space slug %s',
    (slug) => {
      expect(() =>
        validateSpace('My Repository', slug, 'git', 'private'),
      ).toThrow(SpaceServiceError)
    },
  )

  it('rejects an unsupported space type', () => {
    expect(() =>
      validateSpace('My Repository', 'my-repository', 'site', 'private'),
    ).toThrow(SpaceServiceError)
  })

  it('rejects an unsupported visibility', () => {
    expect(() =>
      validateSpace('My Repository', 'my-repository', 'git', 'internal'),
    ).toThrow(SpaceServiceError)
  })

  it('accepts a space name and visibility update', () => {
    expect(() =>
      validateSpaceUpdate({ name: 'New Name', visibility: 'public' }),
    ).not.toThrow()
  })

  it('rejects an empty space update', () => {
    expect(() => validateSpaceUpdate({})).toThrow(SpaceServiceError)
  })

  it('rejects an empty updated space name', () => {
    expect(() => validateSpaceUpdate({ name: '' })).toThrow(
      SpaceServiceError,
    )
  })

  it.each(['writer', 'reader'])(
    'accepts assignable space member role %s',
    (role) => {
      expect(() => validateAssignableSpaceMemberRole(role)).not.toThrow()
    },
  )

  it.each(['owner', 'writer'] as const)(
    'allows Git writes for the %s role',
    (role) => {
      expect(() => validateGitWriteRole(role)).not.toThrow()
    },
  )

  it.each(['reader', undefined] as const)(
    'rejects Git writes for the %s role',
    (role) => {
      expect(() => validateGitWriteRole(role)).toThrow(SpaceServiceError)
    },
  )

  it.each(['owner', 'member', 'admin'])(
    'rejects unassignable space member role %s',
    (role) => {
      expect(() => validateAssignableSpaceMemberRole(role)).toThrow(
        SpaceServiceError,
      )
    },
  )

  it('accepts a valid space member email', () => {
    expect(() =>
      validateSpaceMemberEmail('writer@example.com'),
    ).not.toThrow()
  })

  it.each(['', 'writer', '@example.com', 'writer@example'])(
    'rejects invalid space member email %s',
    (email) => {
      expect(() => validateSpaceMemberEmail(email)).toThrow(
        SpaceServiceError,
      )
    },
  )
})
