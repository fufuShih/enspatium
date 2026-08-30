import * as argon2 from 'argon2'
import type { Kysely } from 'kysely'

import type { Database, User } from '../db/types.js'

export interface PublicUser {
  id: string
  email: string
  displayName: string
  createdAt: string
  updatedAt: string
}

export interface CreateUserInput {
  email: string
  password: string
  displayName: string
}

export type UserServiceErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_CREDENTIALS'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'INTERNAL'

export class UserServiceError extends Error {
  constructor(
    readonly code: UserServiceErrorCode,
    readonly statusCode: number,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause })
    this.name = 'UserServiceError'
  }
}

type PublicUserRow = Pick<
  User,
  'id' | 'email' | 'display_name' | 'created_at' | 'updated_at'
>

export async function createUser(
  db: Kysely<Database>,
  input: CreateUserInput,
): Promise<PublicUser> {
  const displayName = input.displayName.trim()
  const email = input.email.trim().toLowerCase()

  validateCreateUser({ ...input, displayName, email })

  let passwordHash: string

  try {
    passwordHash = await hashPassword(input.password)
  } catch (error) {
    throw new UserServiceError(
      'INTERNAL',
      500,
      'failed to create user',
      error,
    )
  }

  try {
    const user = await db
      .insertInto('users')
      .values({
        display_name: displayName,
        email,
        password_hash: passwordHash,
      })
      .returning([
        'id',
        'email',
        'display_name',
        'created_at',
        'updated_at',
      ])
      .executeTakeFirstOrThrow()

    return toPublicUser(user)
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new UserServiceError('CONFLICT', 409, 'email already exists')
    }

    throw new UserServiceError('INTERNAL', 500, 'user operation failed', error)
  }
}

export async function getUser(
  db: Kysely<Database>,
  id: string,
): Promise<PublicUser> {
  let user: PublicUserRow | undefined

  try {
    user = await db
      .selectFrom('users')
      .select([
        'id',
        'email',
        'display_name',
        'created_at',
        'updated_at',
      ])
      .where('id', '=', id)
      .executeTakeFirst()
  } catch (error) {
    throw new UserServiceError('INTERNAL', 500, 'user operation failed', error)
  }

  if (!user) {
    throw new UserServiceError('NOT_FOUND', 404, 'user not found')
  }

  return toPublicUser(user)
}

export async function authenticateUser(
  db: Kysely<Database>,
  emailInput: string,
  password: string,
): Promise<PublicUser> {
  const email = emailInput.trim().toLowerCase()

  if (!email || !password) {
    throw invalidCredentials()
  }

  let user: User | undefined

  try {
    user = await db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', email)
      .executeTakeFirst()
  } catch (error) {
    throw new UserServiceError(
      'INTERNAL',
      500,
      'failed to authenticate user',
      error,
    )
  }

  if (!user) {
    throw invalidCredentials()
  }

  let matches: boolean

  try {
    matches = await verifyPassword(user.password_hash, password)
  } catch (error) {
    throw new UserServiceError(
      'INTERNAL',
      500,
      'failed to authenticate user',
      error,
    )
  }

  if (!matches) {
    throw invalidCredentials()
  }

  return toPublicUser(user)
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id })
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  return argon2.verify(passwordHash, password)
}

export function validateCreateUser(input: CreateUserInput): void {
  if (!input.displayName) {
    throw new UserServiceError('INVALID_INPUT', 400, 'display name is required')
  }

  if (input.displayName.length > 100) {
    throw new UserServiceError(
      'INVALID_INPUT',
      400,
      'display name must contain at most 100 characters',
    )
  }

  if (
    !input.email ||
    input.email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)
  ) {
    throw new UserServiceError(
      'INVALID_INPUT',
      400,
      'a valid email is required',
    )
  }

  if (input.password.length < 8) {
    throw new UserServiceError(
      'INVALID_INPUT',
      400,
      'password must contain at least 8 characters',
    )
  }

  if (input.password.length > 1024) {
    throw new UserServiceError(
      'INVALID_INPUT',
      400,
      'password must contain at most 1024 characters',
    )
  }
}

function toPublicUser(user: PublicUserRow): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    createdAt: user.created_at.toISOString(),
    updatedAt: user.updated_at.toISOString(),
  }
}

function invalidCredentials(): UserServiceError {
  return new UserServiceError(
    'INVALID_CREDENTIALS',
    401,
    'invalid email or password',
  )
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  )
}
