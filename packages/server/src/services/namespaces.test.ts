import { describe, expect, it } from 'vitest'

import { personalNamespaceSlug } from './namespaces.js'

describe('namespace service', () => {
  it('creates a stable personal namespace slug', () => {
    expect(
      personalNamespaceSlug('cb03c0c8-15b0-456f-accc-e03b8e6b2460'),
    ).toBe('u-cb03c0c815b0456faccce03b8e6b2460')
  })
})
