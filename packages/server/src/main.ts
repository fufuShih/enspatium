import { buildApp } from './app.js'
import { cleanupObjectVersions, startObjectCleanupLoop } from './services/object/retention.js'

const app = await buildApp()
let stopCleanup: (() => Promise<void>) | undefined
app.addHook('preClose', async () => { await stopCleanup?.() })

try {
  await app.listen({
    host: app.config.HOST,
    port: app.config.PORT,
  })
  stopCleanup = startObjectCleanupLoop(
    () => cleanupObjectVersions(app.db, app.config.DATA_ROOT, (error, spaceId) => {
      app.operations.recordCleanupFailure()
      app.log.warn({ err: error, spaceId }, 'Object retention cleanup will retry')
    }),
    error => {
      app.operations.recordCleanupFailure()
      app.log.error({ err: error }, 'Object retention sweep failed')
    },
    app.config.OBJECT_CLEANUP_INTERVAL_SECONDS * 1000,
  )
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void app.close().catch(error => { app.log.error(error); process.exitCode = 1 })
    })
  }
} catch (error) {
  app.log.error(error)
  process.exitCode = 1
  await app.close()
}
