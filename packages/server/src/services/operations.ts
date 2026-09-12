import type { FastifyInstance, FastifyRequest } from 'fastify'
import { Client } from 'pg'
import { freeDiskBytes } from './git/receive-hook.js'
import { getGitProcessStatus } from './git/process.js'
import { requireStorageRoot } from './space/storage.js'

type ErrorKind = 'http' | 'git' | 'cleanup'
export type OperationsAlert = 'database-unavailable' | 'storage-unavailable' | 'low-disk-space' | 'recent-server-errors'
type ErrorEntry = { at: string; kind: ErrorKind; route: string | null; statusCode: number | null }
type ProbeResult = { databaseReady: boolean; storage: { available: boolean; freeBytes: number | null; minimumFreeBytes: number } }
export type OperationsStatus = ProbeResult & {
  status: 'ok' | 'degraded'; checkedAt: string; startedAt: string; uptimeSeconds: number;
  git: { active: number; maximum: number };
  errors: { total: number; recent: ErrorEntry[] };
  alerts: OperationsAlert[];
}

export class OperationsMonitor {
  private readonly started = Date.now()
  private totalErrors = 0
  private lastErrorAt: number | undefined
  private recent: ErrorEntry[] = []
  private readonly recordedRequests = new WeakSet<FastifyRequest>()
  private pending: Promise<OperationsStatus> | undefined
  private previousAlerts = ''
  private lastWarningAt = 0

  constructor(private readonly probe: () => Promise<ProbeResult>, private readonly log: (alerts: OperationsAlert[]) => void) {}

  recordRequest(request: FastifyRequest, statusCode: number, kind: 'http' | 'git' = 'http') {
    if (this.recordedRequests.has(request)) return
    this.recordedRequests.add(request)
    // Only the registered route template; never URLs, parameters, query strings,
    // user identities, headers, exception messages or request/response bodies.
    this.record(kind, request.routeOptions.url ?? null, statusCode)
  }

  recordCleanupFailure() { this.record('cleanup', null, null) }

  private record(kind: ErrorKind, route: string | null, statusCode: number | null) {
    this.totalErrors++
    this.lastErrorAt = Date.now()
    this.recent.unshift({ at: new Date(this.lastErrorAt).toISOString(), kind, route, statusCode })
    this.recent.length = Math.min(this.recent.length, 20)
  }

  refresh(): Promise<OperationsStatus> {
    // Polling tabs and the background sampler share the same bounded probe.
    if (!this.pending) this.pending = this.sample().finally(() => { this.pending = undefined })
    return this.pending
  }

  async waitForProbe() { await this.pending }

  private async sample(): Promise<OperationsStatus> {
    const result = await this.probe()
    const now = Date.now()
    const alerts: OperationsAlert[] = []
    if (!result.databaseReady) alerts.push('database-unavailable')
    if (!result.storage.available) alerts.push('storage-unavailable')
    else if (result.storage.freeBytes !== null && result.storage.freeBytes < result.storage.minimumFreeBytes) alerts.push('low-disk-space')
    if (this.lastErrorAt !== undefined && now - this.lastErrorAt < 15 * 60 * 1000) alerts.push('recent-server-errors')
    const signature = alerts.join(',')
    if (signature !== this.previousAlerts || (alerts.length && now - this.lastWarningAt >= 15 * 60 * 1000)) {
      this.log(alerts)
      this.previousAlerts = signature
      this.lastWarningAt = now
    }
    return {
      ...result, status: alerts.length ? 'degraded' : 'ok', checkedAt: new Date(now).toISOString(),
      startedAt: new Date(this.started).toISOString(), uptimeSeconds: Math.floor((now - this.started) / 1000),
      git: getGitProcessStatus(), errors: { total: this.totalErrors, recent: [...this.recent] }, alerts,
    }
  }
}

async function probeDatabase(databaseUrl: string): Promise<boolean> {
  let client: Client | undefined
  try {
    client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000, query_timeout: 5000, statement_timeout: 5000 })
    client.on('error', () => { /* query/connect failures are reported as unavailable */ })
    await client.connect(); await client.query('select 1'); return true
  }
  catch { return false }
  finally { await client?.end().catch(() => undefined) }
}

async function probeStorage(app: FastifyInstance): Promise<ProbeResult['storage']> {
  const minimumFreeBytes = app.config.STORAGE_MIN_FREE_BYTES
  try {
    const root = await requireStorageRoot(app.config.DATA_ROOT, true)
    return { available: true, freeBytes: await freeDiskBytes(root), minimumFreeBytes }
  } catch { return { available: false, freeBytes: null, minimumFreeBytes } }
}

declare module 'fastify' {
  interface FastifyInstance { operations: OperationsMonitor }
}

export function registerOperations(app: FastifyInstance) {
  const monitor = new OperationsMonitor(async () => {
    const [databaseReady, storage] = await Promise.all([probeDatabase(app.config.DATABASE_URL), probeStorage(app)])
    return { databaseReady, storage }
  }, alerts => {
    if (alerts.length) app.log.warn({ event: 'operations.alert', alerts }, 'Service needs attention')
    else app.log.info({ event: 'operations.recovered' }, 'Service checks recovered')
  })
  app.decorate('operations', monitor)
  let timer: ReturnType<typeof setInterval> | undefined
  app.addHook('onResponse', async (request, reply) => {
    if (reply.statusCode >= 500) monitor.recordRequest(request, reply.statusCode)
  })
  app.addHook('onReady', async () => {
    await monitor.refresh()
    timer = setInterval(() => { void monitor.refresh() }, 30_000)
    timer.unref()
  })
  app.addHook('preClose', async () => {
    clearInterval(timer)
    // Any current probe has at most a bounded connection and query timeout.
    await monitor.waitForProbe()
  })
}
