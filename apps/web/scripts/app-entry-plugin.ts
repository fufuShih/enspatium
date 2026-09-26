import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { parseAppEntryPath, renderAppDocument, type PublicPwaEntry } from '../../../packages/server/src/apps/pwa-document.js'

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
        if (/\.(?:js|webmanifest|png)$/.test(parsed?.child ?? path)) {
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
