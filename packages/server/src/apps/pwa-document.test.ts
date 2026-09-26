import { expect, test } from 'vitest'
import { parseAppEntryPath, pwaBasePath, pwaManifest, pwaWorker, renderAppDocument } from './pwa-document.js'

const entry = { id: '01234567-89ab-cdef-0123-456789abcdef', appType: 'note', enabled: true, name: 'Notebook', themeColor: null, version: 'v1' }
const template = '<!doctype html><html><head><title>web</title></head><body><div id="root"></div><script type="module" src="/assets/main.js"></script></body></html>'

test('manifest has a stable identity and a trailing-slash, instance-specific scope', () => {
  const manifest = pwaManifest(entry)
  expect(manifest).toMatchObject({ id: '/app-id/' + entry.id, start_url: pwaBasePath('note', entry.id), scope: pwaBasePath('note', entry.id), display: 'standalone', theme_color: '#eef2f0' })
  expect(manifest.icons.map(icon => icon.sizes)).toEqual(['192x192', '512x512'])
  expect(pwaManifest({ ...entry, name: 'Renamed', version: 'v2', themeColor: '#123456' }).id).toBe(manifest.id)
  expect(pwaManifest({ ...entry, id: 'other' }).scope).not.toBe(manifest.scope)
})

test('initial HTML links the manifest, escapes installation names and omits disabled metadata', () => {
  const unsafe = '</title><script>alert(1)</script>"&\' $&'
  const html = renderAppDocument(template, { ...entry, name: unsafe })
  expect(html).toContain('rel="manifest"')
  expect(html).toContain('&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;&quot;&amp;&#39; $&')
  expect(html).not.toContain('<script>alert')
  expect(html).toContain('/assets/main.js')
  expect(html).toContain('prefers-color-scheme: dark')
  for (const disabled of [null, { ...entry, enabled: false, name: 'Private secret' }]) {
    expect(renderAppDocument(template, disabled)).not.toContain('manifest')
    expect(renderAppDocument(template, disabled)).not.toContain('Private secret')
  }
})

test('entry paths accept old roots and nested child routes but reject injected scopes', () => {
  const base = pwaBasePath(entry.appType, entry.id)
  expect(parseAppEntryPath(base.slice(0, -1))).toMatchObject({ appId: entry.id, child: '' })
  expect(parseAppEntryPath(base + 'note/item')).toMatchObject({ appId: entry.id, child: 'note/item' })
  for (const path of ['/app/note/bad/', base.replace('/note/', '/note%2f/'), base.replace(entry.id, entry.id + 'extra'), '/app/../' + entry.id]) expect(parseAppEntryPath(path)).toBeNull()
})

test('entry workers never intercept requests, store data or expand their scope', () => {
  const enabled = pwaWorker(true)
  const disabled = pwaWorker(false)
  for (const worker of [enabled, disabled]) {
    expect(worker).not.toMatch(/fetch|caches|CacheStorage|importScripts|localStorage|indexedDB/)
    expect(worker).toContain("addEventListener('install'")
  }
  expect(enabled).toContain('self.clients.claim()')
  expect(disabled).toContain('self.registration.unregister()')
})
