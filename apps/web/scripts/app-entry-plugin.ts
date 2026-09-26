import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { parseAppEntryPath, renderAppDocument, type PublicPwaEntry } from '../../../packages/server/src/apps/pwa-document.js'
import { pwaCachePrefix, pwaWorker } from '../../../packages/server/src/apps/pwa-worker.js'

// Vite transforms its development HTML, using the same public metadata and
// document renderer as production. Never forward a user's cookie or file data.
export function appEntryPlugin(): Plugin {
  return { name: 'enspatium-app-entry', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/app/')) return next()
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.end(); return }
      res.setHeader('Cache-Control', 'private, no-store')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      const proxy = server.config.server.proxy?.['/api']
      const target = typeof proxy === 'string' ? proxy : proxy?.target?.toString()
      if (!target) { res.statusCode = 503; res.end('API proxy is not configured.'); return }
      try {
        const path = req.url.split('?', 1)[0]!
        const parsed = parseAppEntryPath(path)
        if (/\.(?:js|webmanifest|png)$/.test(parsed?.child ?? path) || parsed?.child === 'offline.html') {
          // HMR modules are not immutable assets. Never register the production
          // shell allowlist against Vite's development asset server.
          if (parsed?.child === 'sw.js') {
            const metadata = await fetch(new URL(`/apps/${parsed.appType}/instances/${parsed.appId}/pwa-entry`, target), { signal: AbortSignal.timeout(10_000) })
            res.statusCode = metadata.ok ? 200 : metadata.status
            res.setHeader('Content-Type', 'application/javascript')
            const entry = metadata.ok ? await metadata.json() as PublicPwaEntry : null
            const script = !entry ? 'App resource not found.' : !entry.enabled ? pwaWorker(parsed.appType, parsed.appId, null)
              : `self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));\nself.addEventListener('activate', event => event.waitUntil((async () => { await Promise.all((await caches.keys()).filter(key => key.startsWith(${JSON.stringify(pwaCachePrefix(parsed.appId))})).map(key => caches.delete(key))); await self.clients.claim(); })()));\nself.addEventListener('message', event => { if (event.data === 'PWA_STATUS') event.ports[0]?.postMessage({ ready: false, development: true }); });`
            res.end(req.method === 'HEAD' ? undefined : script)
            return
          }
          const response = await fetch(new URL(req.url, target), { method: req.method, signal: AbortSignal.timeout(10_000) })
          res.statusCode = response.status
          res.setHeader('Content-Type', response.headers.get('content-type') ?? 'text/plain')
          res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()))
          return
        }
        let entry: PublicPwaEntry | null = null
        if (parsed) {
          const response = await fetch(new URL(`/apps/${parsed.appType}/instances/${parsed.appId}/pwa-entry`, target), { signal: AbortSignal.timeout(10_000) })
          if (response.ok) entry = await response.json() as PublicPwaEntry
          else if (response.status !== 404) throw new Error('App metadata unavailable')
        }
        res.statusCode = entry ? 200 : 404
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        const template = await readFile(join(server.config.root, 'index.html'), 'utf8')
        const html = await server.transformIndexHtml(req.url, renderAppDocument(template, entry))
        res.end(req.method === 'HEAD' ? undefined : html)
      } catch {
        res.statusCode = 503; res.setHeader('Content-Type', 'text/plain'); res.end('App entry is temporarily unavailable.')
      }
    })
  } }
}
