import { describe, expect, it } from 'vitest'

import {
  UserServiceError,
  hashPassword,
  validateCreateUser,
  verifyPassword,
} from './users.js'

describe('user service', () => {
  it('hashes and verifies passwords with Argon2id', async () => {
    const passwordHash = await hashPassword('correct-password')

    expect(passwordHash).toMatch(/^\$argon2id\$/)
    await expect(
      verifyPassword(passwordHash, 'correct-password'),
    ).resolves.toBe(true)
    await expect(verifyPassword(passwordHash, 'wrong-password')).resolves.toBe(
      false,
    )
  })

  it('validates new users', () => {
    expect(() =>
      validateCreateUser({
        displayName: 'Felix',
        email: 'felix@example.com',
        password: 'password123',
      }),
    ).not.toThrow()

    expect(() =>
      validateCreateUser({
        displayName: '',
        email: 'invalid',
        password: 'short',
      }),
    ).toThrow(UserServiceError)
  })
})
