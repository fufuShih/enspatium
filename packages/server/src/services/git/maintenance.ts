import { randomUUID } from 'node:crypto'
import { devNull } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import type { Database } from '../../db/index.js'
import { createAuditEvent } from '../audit/audit.js'
import { acquireStorageCheck } from '../space/storage-access.js'
import { getSpaceStoragePath, requireStorageRoot } from '../space/storage.js'
import { inspectStorage } from '../storage-check/index.js'
import { acquireGitMaintenance, GitCapacityError } from './process.js'
import { runMaintenanceGit } from './maintenance-process.js'
import { freeDiskBytes, measureGitObjects } from './receive-hook.js'

export interface GitMaintenanceJob {
  id: string
  spaceId: string
  repository: string
  status: 'running' | 'completed' | 'failed'
  phase: 'checking' | 'compacting' | 'verifying' | 'finished'
  startedAt: string
  finishedAt: string | null
  beforeBytes: number | null
  afterBytes: number | null
  message: string
  auditRecorded: boolean
}

class MaintenanceFailure extends Error {}

export class GitMaintenance {
  private job: GitMaintenanceJob | null = null
  private pending?: Promise<void>
  private admission?: Promise<void>
  private closing = false
  constructor(private readonly app: FastifyInstance) {}

  getStatus() { return { job: this.job ? { ...this.job } : null } }

  async close() {
    this.closing = true
    await this.admission
    await this.pending
  }

  async start(spaceId: string, actorUserId: string) {
    if (this.closing) throw new GitCapacityError()
    // Acquire before the first await: duplicate starts and storage writers cannot
    // slip between admission, checking, compaction and audit persistence.
    const releaseStorage = acquireStorageCheck(this.app.config.DATA_ROOT)
    let admissionFinished!: () => void
    this.admission = new Promise<void>(resolve => { admissionFinished = resolve })
    // The job has its own bounded connection; an outage must not retain the
    // global storage lease indefinitely or change normal application queries.
    const pool = new Pool({ connectionString: this.app.config.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000, query_timeout: 10_000, statement_timeout: 10_000 })
    pool.on('error', error => this.app.log.warn({ event: 'git.maintenance_database_error', err: error }, 'Maintenance database connection failed'))
    const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
    let admitted = false
    try {
      const space = await db.selectFrom('spaces as s')
        .innerJoin('namespaces as n', 'n.id', 's.namespace_id')
        .select(['s.id', 's.namespace_id', 's.slug', 'n.slug as namespace'])
        .where('s.id', '=', spaceId).where('s.type', '=', 'git').executeTakeFirst()
      if (!space) throw Object.assign(new Error('Git Space not found.'), { statusCode: 404, code: 'NOT_FOUND' })
      const job: GitMaintenanceJob = {
        id: randomUUID(), spaceId, repository: `${space.namespace}/${space.slug}`,
        status: 'running', phase: 'checking', startedAt: new Date().toISOString(), finishedAt: null,
        beforeBytes: null, afterBytes: null, auditRecorded: false,
        message: 'Checking repository integrity before maintenance.',
      }
      const actor = { actorUserId, namespaceId: space.namespace_id, spaceId }
      // A persisted start event remains discoverable after a process/host crash.
      await createAuditEvent(db, { ...actor, action: 'git.maintenance_started', metadata: { jobId: job.id } })
      this.job = job
      admitted = true
      this.pending = this.run(db, job, actor).finally(async () => {
        try { await db.destroy() }
        finally {
          releaseStorage()
          job.phase = 'finished'
          job.finishedAt = new Date().toISOString()
        }
      }).catch(error => {
        this.app.log.error({ event: 'git.maintenance_cleanup_failed', jobId: job.id, err: error }, 'Maintenance connection cleanup failed')
      })
      return { ...job }
    } finally {
      try { if (!admitted) { try { await db.destroy() } finally { releaseStorage() } } }
      finally { admissionFinished() }
    }
  }

  private async run(db: Kysely<Database>, job: GitMaintenanceJob, actor: { actorUserId: string; namespaceId: string; spaceId: string }) {
    const signal = AbortSignal.timeout(240_000)
    let releaseGit: (() => void) | undefined
    try {
      const root = await requireStorageRoot(this.app.config.DATA_ROOT, true)
      const report = await inspectStorage(db, root, { spaceId: job.spaceId, deep: true }, signal)
      if (!report.complete || report.status !== 'ok' || report.spaces.length !== 1)
        throw new MaintenanceFailure('Integrity check did not pass. Run the Storage check and resolve its findings before retrying.')
      signal.throwIfAborted()
      releaseGit = acquireGitMaintenance()
      const path = getSpaceStoragePath(root, job.spaceId)
      job.beforeBytes = await measureGitObjects(join(path, 'objects'))
      if (await freeDiskBytes(root) < this.app.config.STORAGE_MIN_FREE_BYTES + job.beforeBytes + 16 * 1024 * 1024)
        throw new MaintenanceFailure('Not enough free disk space for repacking and the configured reserve.')
      const args = [
        '--git-dir', path, '-c', `core.hooksPath=${devNull}`, '-c', 'core.fsmonitor=false',
        '-c', 'gc.auto=0', '-c', 'gc.autoDetach=false',
        '-c', 'pack.threads=1', '-c', 'pack.windowMemory=32m',
      ]
      const git = (command: string[]) => runMaintenanceGit([...args, ...command], signal)
      const config = await git(['config', '--local', '--no-includes', '--list'])
      // This hook is multi-valued; an empty -c value does not clear it. Refuse
      // externally configured hooks instead of executing repository programs.
      if (/^gc\.recentobjectshook=/im.test(config))
        throw new MaintenanceFailure('Repository GC hooks need manual review before maintenance.')
      const refs = () => git(['for-each-ref', '--format=%(refname) %(objectname) %(symref)'])
      const head = () => git(['symbolic-ref', 'HEAD'])
      const beforeRefs = await refs()
      const beforeHead = await head()
      job.phase = 'compacting'
      job.message = 'Compacting Git objects. Git access and storage writes are paused.'
      // Fixed policy: no force, no aggressive repacking, no immediate pruning.
      await git(['gc', '--quiet', '--prune=2.weeks.ago'])
      job.phase = 'verifying'
      job.message = 'Verifying repository integrity and unchanged references.'
      if (beforeRefs !== await refs() || beforeHead !== await head())
        throw new MaintenanceFailure('References changed during maintenance. Keep external writers stopped and run the Storage check.')
      await git(['fsck', '--full', '--no-progress'])
      job.afterBytes = await measureGitObjects(join(path, 'objects'))
      job.status = 'completed'
      job.message = 'Maintenance completed. References and object integrity were verified.'
    } catch (error) {
      job.status = 'failed'
      job.message = error instanceof MaintenanceFailure ? error.message
        : error instanceof GitCapacityError ? 'Git is busy. Retry after active Git operations finish.'
        : signal.aborted ? 'Maintenance exceeded its time budget. Run the Storage check before retrying.'
        : 'Maintenance could not finish. Run the Storage check and review server logs before retrying.'
      this.app.log.warn({ event: 'git.maintenance_failed', jobId: job.id, err: error }, 'Git maintenance failed')
    } finally {
      // Persist completion before releasing storage writes, so deletion cannot
      // remove the Space between the completed operation and its audit event.
      try {
        await createAuditEvent(db, {
          ...actor, action: 'git.maintained', metadata: {
            jobId: job.id, status: job.status, beforeBytes: job.beforeBytes, afterBytes: job.afterBytes,
          },
        })
        job.auditRecorded = true
      } catch (error) {
        this.app.log.error({ event: 'git.maintenance_audit_failed', jobId: job.id, err: error }, 'Git maintenance audit failed')
        job.message += ' The completion audit could not be saved; review server logs.'
      } finally {
        releaseGit?.()
      }
    }
  }
}

declare module 'fastify' {
  interface FastifyInstance { gitMaintenance: GitMaintenance }
}

export function registerGitMaintenance(app: FastifyInstance) {
  const maintenance = new GitMaintenance(app)
  app.decorate('gitMaintenance', maintenance)
  app.addHook('preClose', async () => maintenance.close())
}
