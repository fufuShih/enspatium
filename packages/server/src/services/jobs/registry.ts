import type {
  JobJsonObject,
  JobKind,
  JobPayload,
  StorageCheckJobPayload,
} from '../../db/types/job.types.js'

export const maximumJobPayloadBytes = 16 * 1024
export const maximumJobResultBytes = 1024 * 1024

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class JobValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'JobValidationError'
  }
}

export function isJobKind(kind: string): kind is JobKind {
  return kind === 'storage.check'
}

export function validateJobPayload(kind: JobKind, input: unknown): JobPayload {
  switch (kind) {
    case 'storage.check':
      return validateStorageCheckPayload(input)
  }
}

export function validateJobResult(input: unknown): JobJsonObject {
  if (!isPlainObject(input)) throw new JobValidationError('job result must be a JSON object')
  return normalizeJsonObject(input, maximumJobResultBytes, 'job result')
}

function validateStorageCheckPayload(input: unknown): StorageCheckJobPayload {
  if (!isPlainObject(input)) throw new JobValidationError('storage.check payload must be a JSON object')
  const keys = Object.keys(input)
  if (keys.some(key => key !== 'spaceId' && key !== 'deep')) {
    throw new JobValidationError('storage.check payload contains unknown properties')
  }
  if (input.spaceId !== undefined && (typeof input.spaceId !== 'string' || !uuidPattern.test(input.spaceId))) {
    throw new JobValidationError('storage.check spaceId must be a UUID')
  }
  if (input.deep !== undefined && typeof input.deep !== 'boolean') {
    throw new JobValidationError('storage.check deep must be a boolean')
  }
  const payload: StorageCheckJobPayload = {
    deep: input.deep ?? false,
    // PostgreSQL UUID columns are canonical lowercase; scope comparisons must
    // also accept a valid UUID pasted with uppercase letters.
    ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId.toLowerCase() }),
  }
  return normalizeJsonObject(payload, maximumJobPayloadBytes, 'job payload') as StorageCheckJobPayload
}

function normalizeJsonObject(input: Record<string, unknown>, maximumBytes: number, label: string): JobJsonObject {
  let serialized: string
  try {
    serialized = JSON.stringify(input)
  } catch (error) {
    throw new JobValidationError(`${label} must be JSON serializable`, { cause: error })
  }
  if (Buffer.byteLength(serialized, 'utf8') > maximumBytes) {
    throw new JobValidationError(`${label} is too large`)
  }
  const normalized = JSON.parse(serialized) as unknown
  if (!isPlainObject(normalized)) throw new JobValidationError(`${label} must be a JSON object`)
  return normalized as JobJsonObject
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false
  const prototype = Object.getPrototypeOf(input)
  return prototype === Object.prototype || prototype === null
}
