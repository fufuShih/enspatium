import { lstat, opendir } from 'node:fs/promises'
import { join } from 'node:path'
import { sql, type Kysely } from 'kysely'
import type { Database } from '../../db/index.js'
import { normalizeObjectKey } from '../object/storage.js'
import { getSpaceStoragePath, resolveDataRoot } from '../space/storage.js'
import { withStorageCheck } from '../space/storage-access.js'
import {
  checksum,
  errorCode,
  inspectDirectory,
  inspectTree,
} from './filesystem.js'
import { checkGit } from './git.js'
import {
  finishReport,
  type CheckedSpace,
  type CheckOptions,
  type IssueReporter,
  type StorageCheckReport,
} from './report.js'

const batchSize = 100
export const spaceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Pause this process's storage writers for the entire read-only scan. */
export function checkStorage(
  db: Kysely<Database>,
  dataRoot: string,
  options: CheckOptions = {},
  signal = AbortSignal.timeout(120_000),
): Promise<StorageCheckReport> {
  return withStorageCheck(dataRoot, () =>
    inspectStorage(db, dataRoot, options, signal),
  )
}

/** Caller must hold acquireStorageCheck for the entire inspection. */
export async function inspectStorage(
  db: Kysely<Database>,
  dataRoot: string,
  options: CheckOptions,
  signal: AbortSignal,
): Promise<StorageCheckReport> {
  const root = resolveDataRoot(dataRoot)
  const report: StorageCheckReport = {
    startedAt: new Date().toISOString(),
    finishedAt: '',
    mode: options.deep ? 'deep' : 'basic',
    dataRoot: root,
    scope: options.spaceId ?? 'all',
    consistency: 'service-writes-paused',
    complete: true,
    status: 'ok',
    spaces: [],
    issues: [],
  }
  const issue: IssueReporter = (item, incomplete = false) => {
    report.issues.push(item)
    if (incomplete) report.complete = false
  }
  if (signal.aborted) {
    issue(
      {
        severity: 'error',
        code: 'CHECK_CANCELLED',
        message: 'Check was cancelled or exceeded its time budget.',
      },
      true,
    )
    return finishReport(report)
  }
  if (options.spaceId !== undefined && !spaceIdPattern.test(options.spaceId)) {
    issue(
      {
        severity: 'error',
        code: 'INVALID_SPACE_ID',
        message: 'Space ID must be a UUID.',
      },
      true,
    )
    return finishReport(report)
  }
  const rootStat = await inspectDirectory(root, issue)
  if (!rootStat) {
    report.complete = false
    return finishReport(report)
  }
  try {
    await db
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (tx) => {
        await sql`SET TRANSACTION READ ONLY`.execute(tx)
        await sql`SET LOCAL statement_timeout = '30s'`.execute(tx)
        const registered = new Set<string>()
        let cursor: string | undefined
        for (;;) {
          signal.throwIfAborted()
          let query = tx
            .selectFrom('spaces as s')
            .innerJoin('namespaces as n', 'n.id', 's.namespace_id')
            .select(['s.id', 's.type', 's.slug', 'n.slug as namespace'])
            .orderBy('s.id')
            .limit(batchSize)
          if (options.spaceId) query = query.where('s.id', '=', options.spaceId)
          if (cursor) query = query.where('s.id', '>', cursor)
          const rows = await query.execute()
          if (!rows.length) break
          for (const row of rows) {
            signal.throwIfAborted()
            registered.add(row.id)
            const space: CheckedSpace = {
              ...row,
              objects: 0,
              versions: 0,
              filesChecked: 0,
              hashesChecked: 0,
              versionBytes: '0',
            }
            report.spaces.push(space)
            const spaceIssue: IssueReporter = (item, incomplete) =>
              issue({ ...item, spaceId: space.id }, incomplete)
            const path = getSpaceStoragePath(root, space.id)
            const before = await inspectDirectory(path, spaceIssue)
            if (!before) continue
            const tree = await inspectTree(path, spaceIssue, signal)
            if (space.type === 'git') {
              space.filesChecked = tree.files.size
              await checkGit(
                path,
                tree,
                Boolean(options.deep),
                spaceIssue,
                signal,
              )
            } else
              await checkObjects(
                tx,
                space,
                path,
                tree,
                Boolean(options.deep),
                spaceIssue,
                signal,
              )
            const after = await lstat(path, { bigint: true }).catch(
              () => undefined,
            )
            if (
              !after ||
              after.isSymbolicLink() ||
              !after.isDirectory() ||
              after.dev !== before.dev ||
              after.ino !== before.ino ||
              after.mtimeNs !== before.mtimeNs ||
              after.ctimeNs !== before.ctimeNs
            ) {
              spaceIssue(
                {
                  severity: 'error',
                  code: 'STORAGE_CHANGED',
                  path,
                  message:
                    'Space storage changed outside the service during the scan. Inspect external writers and repeat.',
                },
                true,
              )
            }
          }
          cursor = rows.at(-1)!.id
        }
        if (options.spaceId && !registered.size) {
          issue(
            {
              severity: 'error',
              code: 'SPACE_NOT_FOUND',
              spaceId: options.spaceId,
              message: 'Space is not registered in this database.',
            },
            true,
          )
        } else if (!options.spaceId) {
          try {
            const entries = await opendir(root)
            for await (const entry of entries) {
              signal.throwIfAborted()
              if (registered.has(entry.name)) continue
              issue({
                severity: 'warning',
                code: 'UNREGISTERED_ENTRY',
                path: join(root, entry.name),
                message:
                  'DATA_ROOT entry is not a registered Space. Its contents were not scanned.',
              })
            }
          } catch (error) {
            signal.throwIfAborted()
            issue(
              {
                severity: 'error',
                code: 'DIRECTORY_UNREADABLE',
                path: root,
                message: 'Cannot finish DATA_ROOT inventory.',
                detail: errorCode(error),
              },
              true,
            )
          }
        }
      })
  } catch (error) {
    // Database exceptions can include connection details; output only the code.
    issue(
      {
        severity: 'error',
        code: signal.aborted ? 'CHECK_CANCELLED' : 'CHECK_FAILED',
        message: signal.aborted
          ? 'Check was cancelled or exceeded its time budget. Retry with a single Space.'
          : 'Check could not finish. Verify the database connection, applied migrations and storage access.',
        detail: errorCode(error),
      },
      true,
    )
  }
  const after = await lstat(root, { bigint: true }).catch(() => undefined)
  if (
    !after ||
    after.isSymbolicLink() ||
    after.dev !== rootStat.dev ||
    after.ino !== rootStat.ino ||
    after.mtimeNs !== rootStat.mtimeNs ||
    after.ctimeNs !== rootStat.ctimeNs
  ) {
    issue(
      {
        severity: 'error',
        code: 'STORAGE_CHANGED',
        path: root,
        message:
          'DATA_ROOT changed outside the service during the scan. Inspect external writers and repeat.',
      },
      true,
    )
  }
  if (
    signal.aborted &&
    !report.issues.some((i) => i.code === 'CHECK_CANCELLED')
  )
    issue(
      {
        severity: 'error',
        code: 'CHECK_CANCELLED',
        message: 'Check exceeded its time budget.',
      },
      true,
    )
  return finishReport(report)
}

async function checkObjects(
  db: Kysely<Database>,
  space: CheckedSpace,
  root: string,
  tree: Awaited<ReturnType<typeof inspectTree>>,
  deep: boolean,
  issue: IssueReporter,
  signal: AbortSignal,
) {
  let objectCursor: string | undefined
  for (;;) {
    signal.throwIfAborted()
    let query = db
      .selectFrom('space_objects as o')
      .leftJoin('space_object_versions as v', 'v.id', 'o.current_version_id')
      .select([
        'o.id',
        'o.key',
        'o.revision',
        'o.is_deleted',
        'o.current_version_id',
        'o.size_bytes',
        'o.checksum_sha256',
        'o.content_type',
        'v.object_id as version_object_id',
        'v.space_id as version_space_id',
        'v.revision as version_revision',
        'v.is_deleted as version_deleted',
        'v.size_bytes as version_size',
        'v.checksum_sha256 as version_checksum',
        'v.content_type as version_content_type',
        'v.inactive_at',
        'v.purge_started_at',
      ])
      .select(
        sql<number>`(select max(revision) from space_object_versions where object_id = o.id)`.as(
          'latest_revision',
        ),
      )
      .where('o.space_id', '=', space.id)
      .orderBy('o.id')
      .limit(batchSize)
    if (objectCursor) query = query.where('o.id', '>', objectCursor)
    const objects = await query.execute()
    if (!objects.length) break
    for (const object of objects) {
      space.objects++
      // A deletion head intentionally retains the last content's display metadata.
      if (
        object.version_object_id !== object.id ||
        object.version_space_id !== space.id ||
        object.revision !== object.version_revision ||
        object.revision !== object.latest_revision ||
        object.is_deleted !== object.version_deleted ||
        object.inactive_at ||
        object.purge_started_at ||
        (!object.is_deleted &&
          (object.size_bytes !== object.version_size ||
            object.checksum_sha256 !== object.version_checksum ||
            object.content_type !== object.version_content_type))
      ) {
        issue({
          severity: 'error',
          code: 'OBJECT_HEAD_MISMATCH',
          objectId: object.id,
          versionId: object.current_version_id,
          key: object.key,
          message:
            'Current Object metadata does not match its latest available version.',
        })
      }
    }
    objectCursor = objects.at(-1)!.id
  }

  const referenced = new Set<string>()
  let versionBytes = 0n
  let versionCursor: string | undefined
  for (;;) {
    signal.throwIfAborted()
    let query = db
      .selectFrom('space_object_versions as v')
      .innerJoin('space_objects as o', 'o.id', 'v.object_id')
      .selectAll('v')
      .select(['o.key', 'o.current_version_id'])
      .where('v.space_id', '=', space.id)
      .orderBy('v.id')
      .limit(batchSize)
    if (versionCursor) query = query.where('v.id', '>', versionCursor)
    const versions = await query.execute()
    if (!versions.length) break
    for (const version of versions) {
      signal.throwIfAborted()
      space.versions++
      versionBytes += BigInt(version.size_bytes)
      const identity = {
        objectId: version.object_id,
        versionId: version.id,
        key: version.key,
      }
      if (version.id !== version.current_version_id && !version.inactive_at) {
        issue({
          ...identity,
          severity: 'error',
          code: 'VERSION_STATE_MISMATCH',
          message: 'Non-current version has no inactive timestamp.',
        })
      }
      if (version.purge_started_at)
        issue({
          ...identity,
          severity: 'warning',
          code: 'PURGE_PENDING',
          message:
            'Retention purge is pending. Its bytes may already be absent; metadata cleanup must be retried by the normal service.',
        })
      if (version.is_deleted) continue
      let locator: string
      try {
        locator = normalizeObjectKey(version.storage_key ?? '')
      } catch {
        issue({
          ...identity,
          severity: 'error',
          code: 'INVALID_STORAGE_KEY',
          message: 'Version locator is invalid; it was not accessed.',
        })
        continue
      }
      referenced.add(locator)
      const file = tree.files.get(locator)
      if (!file) {
        if (!version.purge_started_at && tree.complete)
          issue({
            ...identity,
            severity: 'error',
            code: 'OBJECT_CONTENT_MISSING',
            path: join(root, ...locator.split('/')),
            message: 'Version metadata exists but its content is missing.',
          })
        continue
      }
      space.filesChecked++
      if (version.purge_started_at) continue
      if (file.stat.size !== BigInt(version.size_bytes)) {
        issue({
          ...identity,
          severity: 'error',
          code: 'OBJECT_SIZE_MISMATCH',
          path: file.path,
          message: `Expected ${version.size_bytes} bytes; found ${file.stat.size}.`,
        })
        continue
      }
      if (deep) {
        try {
          const actual = await checksum(file, signal)
          space.hashesChecked++
          if (actual !== version.checksum_sha256)
            issue({
              ...identity,
              severity: 'error',
              code: 'OBJECT_CHECKSUM_MISMATCH',
              path: file.path,
              message: 'Content SHA-256 does not match the stored version.',
              detail: `expected=${version.checksum_sha256} actual=${actual}`,
            })
        } catch (error) {
          signal.throwIfAborted()
          issue(
            {
              ...identity,
              severity: 'error',
              code:
                error instanceof Error && error.message === 'FILE_CHANGED'
                  ? 'STORAGE_CHANGED'
                  : 'FILE_UNREADABLE',
              path: file.path,
              message:
                'Could not verify content. Inspect external writers and storage access before repeating.',
              detail: errorCode(error),
            },
            true,
          )
        }
      }
    }
    versionCursor = versions.at(-1)!.id
  }
  space.versionBytes = String(versionBytes)
  for (const [key, file] of tree.files) {
    if (referenced.has(key)) continue
    const temporary = /^\..+\.[0-9a-f-]{36}\.upload$/i.test(
      key.split('/').at(-1)!,
    )
    issue({
      severity: 'warning',
      code: temporary ? 'TEMPORARY_FILE' : 'UNREFERENCED_FILE',
      path: file.path,
      message: temporary
        ? 'Unreferenced upload temporary file. It may belong to an interrupted or active upload.'
        : 'File is not referenced by any retained version in this Space.',
    })
  }
}
