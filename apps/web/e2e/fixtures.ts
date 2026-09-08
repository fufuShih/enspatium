import { test as base, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createServer, type ViteDevServer } from 'vite'
import { createFixture } from '../../../packages/server/tests/fixture.js'

type Environment = Awaited<ReturnType<typeof createFixture>> & { webOrigin: string }

export const test = base.extend<{ browserErrors: void }, { environment: Environment }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires destructured fixture dependencies.
  environment: [async ({}, provide) => {
    const cleanups: (() => Promise<void>)[] = []
    const failures: unknown[] = []
    let web: ViteDevServer | undefined
    try {
      const backend = await createFixture({
        after: cleanup => { cleanups.push(cleanup) },
        diagnostic: message => { console.log('[e2e] ' + message) },
      })
      web = await createServer({
        root: fileURLToPath(new URL('../', import.meta.url)),
        configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
        // Keep optimization caches separate from an already-running dev server.
        cacheDir: join(backend.root, 'vite-cache'),
        logLevel: 'error',
        server: {
          host: '127.0.0.1', port: 0, open: false,
          proxy: { '/api': { target: backend.origin, rewrite: path => path.replace(/^\/api/, '') } },
        },
      })
      await web.listen()
      const webOrigin = web.resolvedUrls?.local[0]
      if (!webOrigin) throw new Error('Test frontend did not start')
      await provide({ ...backend, webOrigin: webOrigin.replace(/\/$/, '') })
    } catch (error) { failures.push(error) }
    try { await web?.close() } catch (error) { failures.push(error) }
    for (const cleanup of cleanups.reverse()) {
      try { await cleanup() } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'E2E environment failed')
  }, { scope: 'worker', timeout: 60_000 }],
  baseURL: async ({ environment }, provide) => { await provide(environment.webOrigin) },
  browserErrors: [async ({ page }, provide) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await provide()
    expect(errors, 'Uncaught browser errors').toEqual([])
  }, { auto: true }],
})

export { expect } from '@playwright/test'
