import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { AppInstanceParamsSchema } from './types/apps.types.js'
import { PublicPwaEntrySchema } from './types/space-apps.types.js'
import { getPublicPwaEntry, getPublicPwaIcon } from '../services/app-pwa.js'
import { parseAppEntryPath, pwaManifest, pwaWorker, renderAppDocument } from '../apps/pwa-document.js'
import { SpaceServiceError } from '../services/space/space.js'

export const appEntryRoutes: FastifyPluginAsyncTypebox = async app => {
  app.get('/apps/:appType/instances/:appId/pwa-entry', {
    schema: { operationId: 'getAppPwaEntry', tags: ['apps'], security: [{}], params: AppInstanceParamsSchema, response: { 200: PublicPwaEntrySchema } },
  }, async (request, reply) => {
    reply.header('cache-control', 'private, no-store')
    return getPublicPwaEntry(app.db, request.params.appType, request.params.appId)
  })

  let html: Promise<string> | undefined
  async function template() {
    html ??= readFile(join(app.config.WEB_ROOT, 'index.html'), 'utf8').catch(error => { html = undefined; throw error })
    return html
  }
  // These are document/resource routes, not API routes. Caddy forwards /app/*
  // before its SPA fallback; never use index.html as a worker or manifest.
  app.get('/app/*', { schema: { hide: true } }, async (request, reply) => {
    reply.header('cache-control', 'private, no-store').header('x-content-type-options', 'nosniff')
    const path = request.url.split('?', 1)[0]!
    const parsed = parseAppEntryPath(path)
    const resource = parsed?.child ?? path.split('/').at(-1)!
    const isResource = /\.(?:js|webmanifest|png)$/.test(resource)
    let entry = null
    try {
      if (!parsed) throw new SpaceServiceError('NOT_FOUND', 404, 'App not found.')
      entry = await getPublicPwaEntry(app.db, parsed.appType, parsed.appId)
    } catch (error) {
      if (!(error instanceof SpaceServiceError) || error.statusCode !== 404) throw error
      if (isResource) return reply.code(404).type('text/plain').send('App resource not found.')
      reply.code(404)
    }
    if (entry && isResource) {
      if (resource === 'sw.js') return reply.type('application/javascript').send(pwaWorker(entry.enabled))
      if (entry.enabled && resource === 'manifest.webmanifest') return reply.type('application/manifest+json').send(pwaManifest(entry))
      if (entry.enabled && (resource === 'icon-192.png' || resource === 'icon-512.png')) {
        return reply.type('image/png').send(await getPublicPwaIcon(app.db, entry.appType, entry.id, resource === 'icon-192.png' ? 192 : 512))
      }
      return reply.code(404).type('text/plain').send('App resource not found.')
    }
    // Permit bundled scripts, workers, blob media and Chakra's inline styles.
    // No user HTML is rendered; private data is loaded by authorized APIs.
    reply.header('content-security-policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self'; frame-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; manifest-src 'self'")
    try { return reply.type('text/html').send(renderAppDocument(await template(), entry)) } catch {
      return reply.code(503).type('text/plain').send('App frontend is unavailable. Build the web application before starting the server.')
    }
  })
}
