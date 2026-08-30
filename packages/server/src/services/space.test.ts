import { describe, expect, it } from 'vitest'

import {
  SpaceServiceError,
  normalizeSpaceSlug,
  validateSpace,
} from './space.js'

describe('space service', () => {
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
})
