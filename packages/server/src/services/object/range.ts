export type ObjectRange =
  | { kind: 'full' }
  | { kind: 'partial'; start: number; end: number }
  | { kind: 'unsatisfiable' }

/** Single byte ranges only. Unsupported or malformed ranges use the full response. */
export function resolveObjectRange(size: number, range?: string, ifRange?: string, etag?: string): ObjectRange {
  // We publish a strong ETag, not Last-Modified: timestamps cannot distinguish
  // multiple object revisions written within the same second.
  if (!range || (ifRange !== undefined && ifRange.trim() !== etag)) return { kind: 'full' }
  const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim())
  if (!match || (!match[1] && !match[2])) return { kind: 'full' }
  const length = BigInt(size)
  if (!match[1]) {
    const suffix = BigInt(match[2]!)
    if (!length || !suffix) return { kind: 'unsatisfiable' }
    return { kind: 'partial', start: Number(suffix >= length ? 0n : length - suffix), end: size - 1 }
  }
  // BigInt keeps enormous client-supplied offsets from overflowing or rounding.
  const start = BigInt(match[1])
  const end = match[2] ? BigInt(match[2]) : length - 1n
  if (match[2] && end < start) return { kind: 'full' }
  if (start >= length) return { kind: 'unsatisfiable' }
  return { kind: 'partial', start: Number(start), end: Number(end >= length ? length - 1n : end) }
}
