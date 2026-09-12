import { resolveDataRoot } from './storage.js'

type Access = { writers: number; checking: boolean }
const roots = new Map<string, Access>()

export class StorageBusyError extends Error {
  readonly code = 'STORAGE_BUSY'
  readonly statusCode = 409
  constructor() {
    super(
      'Storage is busy. Retry after the current storage operation finishes.',
    )
  }
}

// The current deployment uses one backend process. All storage mutations must
// hold a lease for their entire filesystem + DB operation, including rollback.
function acquire(dataRoot: string, checking: boolean): () => void {
  const root = resolveDataRoot(dataRoot)
  const state = roots.get(root) ?? { writers: 0, checking: false }
  if (state.checking || (checking && state.writers > 0))
    throw new StorageBusyError()
  if (checking) state.checking = true
  else state.writers++
  roots.set(root, state)
  let released = false
  return () => {
    if (released) return
    released = true
    if (checking) state.checking = false
    else state.writers--
    if (!state.checking && !state.writers) roots.delete(root)
  }
}

export const acquireStorageWrite = (dataRoot: string) =>
  acquire(dataRoot, false)

export async function withStorageWrite<T>(
  dataRoot: string,
  run: () => Promise<T>,
): Promise<T> {
  const release = acquireStorageWrite(dataRoot)
  try {
    return await run()
  } finally {
    release()
  }
}

export async function withStorageCheck<T>(
  dataRoot: string,
  run: () => Promise<T>,
): Promise<T> {
  const release = acquire(dataRoot, true)
  try {
    return await run()
  } finally {
    release()
  }
}
