import { readFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { createSpace, register, signIn } from './helpers.js'
import { epubFixture, pdfFixture } from './ebook-fixtures.js'

// Chrome does not apply context.ignoreHTTPSErrors to worker installation.
// Optionally trust only the disposable server's certificate public key.
const spki = process.env.PWA_TEST_CERT_SPKI
if (spki && !/^[A-Za-z0-9+/]{43}=$/.test(spki)) throw new Error('Invalid PWA test certificate pin')
test.use({ launchOptions: { args: spki ? [`--ignore-certificate-errors-spki-list=${spki}`] : [] } })

// Opt in only against a disposable local pair of production images.
test('production HTTPS serves App HTML, manifests, workers and all built-in views through Caddy', async ({ browser }, testInfo) => {
  test.skip(!process.env.PWA_DEPLOYMENT_URL, 'Set PWA_DEPLOYMENT_URL for an isolated local HTTPS deployment.')
  test.setTimeout(120_000)
  const origin = new URL(process.env.PWA_DEPLOYMENT_URL!)
  expect(origin.protocol).toBe('https:')
  expect(origin.hostname).toBe('localhost')
  const context = await browser.newContext({ baseURL: origin.origin, ignoreHTTPSErrors: true })
  try {
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const user = await register(page, 'Production PWA owner')
    await signIn(page, user)
    expect((await context.cookies()).find(cookie => cookie.name === 'enspatium_session')).toMatchObject({ secure: true, httpOnly: true, sameSite: 'Strict' })
    const space = await createSpace(page, 'Production notebook', undefined, 'note')
    const api = `/api/namespaces/${space.account}/spaces/${space.slug}`
    const { id } = await (await page.request.get(api)).json() as { id: string }
    const instances = [{ id, appType: 'note' }]
    for (const appType of ['ebook', 'media']) {
      const response = await page.request.post(api + '/apps', { data: { appType, name: appType } })
      expect(response.status()).toBe(201)
      instances.push(await response.json())
    }
    for (const instance of instances) {
      const response = await page.request.put(`${api}/apps/${instance.id}/pwa`, { data: { name: instance.appType + ' installation',
        pwa: { enabled: true, iconObjectId: null, themeColor: null, offlinePolicy: 'shell' }, publishAcknowledged: true } })
      expect(response.status()).toBe(200)
    }
    for (const [key, data, type] of [['Private.md', Buffer.from('# Private production content'), 'text/markdown'], ['Story.epub', epubFixture(), 'application/epub+zip'], ['Story.pdf', pdfFixture(), 'application/pdf'],
      ['photo.png', await readFile(new URL('./media-fixtures/photo.png', import.meta.url)), 'image/png']] as const) {
      expect((await page.request.put(api + '/objects/' + key, { data, headers: { 'content-type': type } })).status()).toBe(201)
    }
    const base = `/app/note/${id}/`
    const response = await page.goto(base)
    expect(response!.status()).toBe(200)
    expect(response!.headers()['content-security-policy']).toContain("manifest-src 'self'")
    const html = await response!.text()
    expect(html).toContain(`href="${base}manifest.webmanifest"`)
    expect(html).not.toContain('/src/main.tsx')
    await page.getByRole('link', { name: 'Open Private.md' }).click()
    await page.reload()
    await expect(page.getByRole('textbox', { name: 'Note content', exact: true })).toContainText('Private production content')
    const noteUrl = page.url()
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).filter(registration => registration.active).length)).toBe(1)
    await page.getByRole('button', { name: 'Installation help' }).click()
    await expect(page.getByRole('dialog', { name: 'Install this app' })).toContainText('Offline page ready')
    await page.getByRole('dialog', { name: 'Install this app' }).getByRole('button', { name: 'Close' }).click()
    for (const instance of instances) {
      const path = `/app/${instance.appType}/${instance.id}/`
      const manifest = await page.request.get(path + 'manifest.webmanifest')
      expect(manifest.headers()['content-type']).toContain('application/manifest+json')
      expect(await manifest.json()).toMatchObject({ id: '/app-id/' + instance.id, scope: path, start_url: path })
      expect((await page.request.get(path + 'icon-512.png')).headers()['content-type']).toContain('image/png')
      const worker = await page.request.get(path + 'sw.js')
      expect(worker.headers()['content-type']).toContain('javascript')
      expect(await worker.text()).not.toContain('<html')
    }
    const library = instances.find(instance => instance.appType === 'ebook')!
    const libraryPath = `/app/ebook/${library.id}/`
    await page.goto(libraryPath)
    await page.getByRole('link', { name: 'Read Story.epub' }).click()
    await page.reload()
    await expect(page.frameLocator('iframe[title="EPUB chapter"]').getByRole('heading', { name: 'The beginning' })).toBeVisible()
    await page.goto(libraryPath)
    await page.getByRole('link', { name: 'Read Story.pdf' }).click()
    await expect(page.getByLabel('PDF page 1')).toBeVisible()
    const media = instances.find(instance => instance.appType === 'media')!
    await page.goto(`/app/media/${media.id}/`)
    await page.getByRole('button', { name: 'Open media photo.png' }).click()
    const photo = page.getByRole('region', { name: 'Now playing' }).getByRole('img')
    await expect.poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
    await expect.poll(() => page.evaluate(async () => (await caches.keys()).length)).toBe(3)
    const cacheSnapshot = await page.evaluate(async () => Promise.all((await caches.keys()).map(async name => {
      const cache = await caches.open(name)
      return { name, entries: await Promise.all((await cache.keys()).map(async request => ({ url: request.url, body: await (await cache.match(request))!.text() }))) }
    })))
    for (const cache of cacheSnapshot) {
      expect(cache.name).toMatch(/^enspatium-pwa:[0-9a-f-]{36}:[0-9a-f]{64}$/)
      expect(cache.entries).toHaveLength(4)
      for (const entry of cache.entries) {
        expect(new URL(entry.url).pathname).toMatch(/^\/assets\/[\w-]+\.(?:js|css)$|^\/app\/[a-z]+\/[0-9a-f-]{36}\/offline\.html$/)
        expect(entry.body).not.toContain('Private production content')
        expect(entry.body).not.toContain(user.email)
        expect(entry.body).not.toContain('enspatium_session')
      }
    }
    const mediaCache = cacheSnapshot.find(cache => cache.name.startsWith(`enspatium-pwa:${media.id}:`))!.name
    await page.evaluate(name => caches.delete(name), mediaCache)
    await page.reload()
    await page.getByRole('button', { name: 'Installation help' }).click()
    await expect(page.getByRole('dialog', { name: 'Install this app' })).toContainText('Offline page ready')
    await page.getByRole('dialog', { name: 'Install this app' }).getByRole('button', { name: 'Close' }).click()
    await expect.poll(() => page.evaluate(() => caches.keys())).toHaveLength(3)
    const missing = await page.request.get('/app/note/00000000-0000-0000-0000-000000000000/sw.js')
    expect(missing.status()).toBe(404)
    expect(missing.headers()['content-type']).not.toContain('text/html')
    await page.screenshot({ path: testInfo.outputPath('production-pwa-media.png'), animations: 'disabled' })
    await context.setOffline(true)
    await page.goto(noteUrl + '?search=private-query')
    await expect(page.getByRole('heading', { name: 'Connection needed' })).toBeVisible()
    await expect(page.getByRole('status')).toHaveText('You are offline.')
    await expect(page.getByRole('textbox', { name: 'Note content', exact: true })).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Connection needed' })).toBeVisible()
    expect(await page.evaluate(() => caches.keys())).toHaveLength(3)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ colorScheme: 'dark' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('offline-shell-dark-mobile.png'), animations: 'disabled' })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.screenshot({ path: testInfo.outputPath('offline-shell-light-mobile.png'), animations: 'disabled' })
    await context.setOffline(false)
    await expect(page.getByRole('status')).toContainText('A network connection is available')
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('textbox', { name: 'Note content', exact: true })).toContainText('Private production content')
    // Disable this App and preserve the two other App caches and registrations.
    expect((await page.request.put(`${api}/apps/${id}/pwa`, { data: { name: 'note installation',
      pwa: { enabled: false, iconObjectId: null, themeColor: null, offlinePolicy: 'shell' } } })).status()).toBe(200)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Installation help' })).toHaveCount(0)
    await expect.poll(() => page.evaluate(async () => (await caches.keys()).sort())).toEqual(cacheSnapshot.filter(cache => !cache.name.startsWith(`enspatium-pwa:${id}:`)).map(cache => cache.name).sort())
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(2)
    expect(errors).toEqual([])
  } finally { await context.close() }
})
