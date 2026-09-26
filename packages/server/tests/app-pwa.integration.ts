import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { expect, test, vi } from 'vitest'
import { createFixture } from './fixture.js'
import type { PublicSpace } from '../src/db/types/space.types.js'
import type { PublicUser } from '../src/db/types/user.types.js'
import type { AppPwaSettings } from '../src/db/types/app.types.js'
import * as audit from '../src/services/audit/audit.js'

test('PWA settings publish only consented metadata, preserve identity, scope icons and roll back atomically', async ({ onTestFinished }) => {
  const { app, root, session } = await createFixture({ after: cleanup => onTestFinished(cleanup), diagnostic: message => console.info(message) })
  app.config.WEB_ROOT = join(root, 'frontend')
  await mkdir(app.config.WEB_ROOT)
  await writeFile(join(app.config.WEB_ROOT, 'index.html'), '<!doctype html><html><head><title>web</title></head><body><div id="root"></div><script type="module" src="/assets/main.js"></script></body></html>')
  const owner = session()
  const credentials = { email: 'pwa-owner@example.com', password: 'Pwa-tests-12345' }
  const user = await owner.request<PublicUser>('POST', '/users', 201, { ...credentials, displayName: 'Owner' })
  await owner.request('POST', '/auth/login', 200, credentials)
  const namespace = await app.db.selectFrom('namespaces').selectAll().where('owner_user_id', '=', user.id).executeTakeFirstOrThrow()
  const base = `/namespaces/${namespace.slug}/spaces`
  const space = await owner.request<PublicSpace>('POST', base, 201, { name: 'Private Space name', slug: 'private-space', type: 'object', app: 'note' })
  const apps = `${base}/${space.slug}/apps`
  const appPath = `/app/note/${space.id}/`
  const entryPath = `/apps/note/instances/${space.id}/pwa-entry`
  const pwaUrl = `${apps}/${space.id}/pwa`
  const pwa: AppPwaSettings = { enabled: true, iconObjectId: null, themeColor: '#ABCDEF', offlinePolicy: 'shell' }
  const body = { name: 'Public notebook', pwa, publishAcknowledged: true }
  const guest = session()
  expect(await guest.request('GET', entryPath)).toEqual({ id: space.id, appType: 'note', enabled: false })
  const disabledHtml = await app.inject(appPath)
  expect(disabledHtml.statusCode).toBe(200)
  expect(disabledHtml.body).not.toContain('Private Space name')
  expect(disabledHtml.body).not.toContain('manifest')
  expect((await app.inject(appPath + 'manifest.webmanifest')).statusCode).toBe(404)
  await guest.request('PUT', pwaUrl, 401, body)
  await owner.request('PUT', pwaUrl, 400, { ...body, publishAcknowledged: false })
  await owner.request('PUT', pwaUrl, 400, { ...body, pwa: { ...pwa, themeColor: 'red' } })
  await owner.request('PUT', pwaUrl, 400, { ...body, pwa: { ...pwa, offlinePolicy: 'all-content' } })
  const updated = await owner.request('PUT', pwaUrl, 200, body)
  expect(updated).toMatchObject({ id: space.id, spaceId: space.id, name: body.name, pwa: { enabled: true, themeColor: '#abcdef' } })
  expect(await guest.request('GET', entryPath)).toMatchObject({ id: space.id, appType: 'note', enabled: true, name: body.name, themeColor: '#abcdef' })
  const manifest = await app.inject(appPath + 'manifest.webmanifest')
  expect(manifest.headers['content-type']).toContain('application/manifest+json')
  expect(manifest.headers['cache-control']).toBe('private, no-store')
  expect(manifest.headers['x-content-type-options']).toBe('nosniff')
  expect(manifest.json()).toMatchObject({ id: '/app-id/' + space.id, start_url: appPath, scope: appPath, name: body.name, display: 'standalone' })
  for (const value of [namespace.slug, space.slug, credentials.email, 'iconObjectId', 'config', 'spaceId']) expect(manifest.body).not.toContain(value)
  const html = await app.inject(appPath + 'note/' + randomUUID())
  expect(html.statusCode).toBe(200)
  expect(html.body).toContain(`href="${appPath}manifest.webmanifest"`)
  expect(html.body).toContain('<title>Public notebook</title>')
  expect(html.headers['content-security-policy']).toContain("manifest-src 'self'")
  const head = await app.inject({ method: 'HEAD', url: appPath + 'manifest.webmanifest' })
  expect(head.statusCode).toBe(200); expect(head.body).toBe('')
  const worker = await app.inject(appPath + 'sw.js')
  expect(worker.headers['content-type']).toContain('application/javascript')
  expect(worker.headers['service-worker-allowed']).toBeUndefined()
  expect(worker.body).not.toMatch(/fetch|caches|indexedDB/)
  const second = await owner.request<{ id: string }>('POST', apps, 201, { appType: 'note', name: 'Second' })
  await owner.request('PUT', `${apps}/${second.id}/pwa`, 200, { ...body, name: 'Second' })
  const secondManifest = (await app.inject(`/app/note/${second.id}/manifest.webmanifest`)).json()
  expect(secondManifest.id).not.toBe(manifest.json().id)
  expect(secondManifest.scope).not.toBe(manifest.json().scope)
  for (const size of [192, 512]) {
    const icon = await app.inject(appPath + `icon-${size}.png`)
    expect(icon.statusCode).toBe(200)
    expect(await sharp(icon.rawPayload).metadata()).toMatchObject({ format: 'png', width: size, height: size })
  }

  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: credentials })
  const cookies = login.headers['set-cookie']
  const cookie = (Array.isArray(cookies) ? cookies : [String(cookies)]).map(value => value.split(';')[0]).join('; ')
  const source = await sharp({ create: { width: 250, height: 180, channels: 3, background: 'blue' } }).jpeg().withExif({ IFD0: { Copyright: 'Private EXIF' } }).toBuffer()
  async function upload(path: string, data: Buffer) {
    const response = await app.inject({ method: 'PUT', url: `${base}/${space.slug}/objects/${path}`, headers: { cookie, 'content-type': 'application/octet-stream' }, payload: data })
    expect(response.statusCode).toBe(201)
    return response.json() as { id: string; versionId: string }
  }
  const object = await upload('private-icon.jpg', source)
  const custom = { ...body, pwa: { ...pwa, iconObjectId: object.id } }
  await owner.request('PUT', pwaUrl, 200, custom)
  const safeIcon = await app.inject(appPath + 'icon-512.png')
  expect((await sharp(safeIcon.rawPayload).metadata()).exif).toBeUndefined()
  expect(safeIcon.body).not.toContain('Private EXIF')
  expect((await app.inject(`${base}/${space.slug}/objects/private-icon.jpg`)).statusCode).toBe(401)
  await upload('private-icon.jpg', Buffer.from('No longer an image'))
  expect((await app.inject(appPath + 'icon-512.png')).rawPayload).toEqual(safeIcon.rawPayload)
  await owner.request('PUT', pwaUrl, 400, { ...custom, refreshIcon: true })
  const svg = await upload('unsafe.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))
  await owner.request('PUT', pwaUrl, 400, { ...body, pwa: { ...pwa, iconObjectId: svg.id } })
  await owner.request('PUT', pwaUrl, 400, { ...body, pwa: { ...pwa, iconObjectId: randomUUID() } })
  const other = await owner.request<PublicSpace>('POST', base, 201, { name: 'Other', slug: 'other', type: 'object', app: 'note' })
  await owner.request('PUT', `${base}/other/apps/${space.id}/pwa`, 404, body)
  await owner.request('PUT', `${base}/other/apps/${other.id}/pwa`, 400, custom)

  const before = await app.db.selectFrom('space_apps').selectAll().where('id', '=', space.id).executeTakeFirstOrThrow()
  const failure = vi.spyOn(audit, 'createAuditEvent').mockRejectedValue(new Error('Test failure'))
  try { await owner.request('PUT', pwaUrl, 500, { ...body, name: 'Should roll back' }) } finally { failure.mockRestore() }
  expect(await app.db.selectFrom('space_apps').selectAll().where('id', '=', space.id).executeTakeFirstOrThrow()).toEqual(before)
  await owner.request('DELETE', `${base}/${space.slug}/objects/private-icon.jpg?expectedVersion=${(await owner.request<{ versionId: string }>('GET', `${base}/${space.slug}/object-head?key=private-icon.jpg`)).versionId}`, 204)
  expect((await app.inject(appPath + 'icon-512.png')).rawPayload).toEqual(safeIcon.rawPayload)
  await owner.request('PUT', pwaUrl, 200, { ...custom, pwa: { ...custom.pwa, enabled: false } })
  expect(await guest.request('GET', entryPath)).toEqual({ id: space.id, appType: 'note', enabled: false })
  for (const resource of ['manifest.webmanifest', 'icon-192.png', 'icon-512.png']) expect((await app.inject(appPath + resource)).statusCode).toBe(404)
  expect((await app.inject(appPath + 'sw.js')).body).toContain('self.registration.unregister()')
  expect((await app.inject(appPath)).body).not.toContain('Public notebook')
  expect((await app.inject(`/app/note/${second.id}/manifest.webmanifest`)).statusCode).toBe(200)
  await owner.request('DELETE', `${apps}/${space.id}`, 204)
  for (const resource of ['', 'note/child', 'manifest.webmanifest', 'sw.js', 'icon-192.png']) expect((await app.inject(appPath + resource)).statusCode).toBe(404)
  for (const path of [`/app/media/${second.id}/sw.js`, '/app/note/invalid/sw.js', `/app/note/${second.id}/nested/sw.js`]) {
    const response = await app.inject(path)
    expect(response.statusCode).toBe(404); expect(response.body).not.toContain('<html')
  }
})

test('readers, writers, nonmembers and disabled users cannot change PWA settings', async ({ onTestFinished }) => {
  const { app, session } = await createFixture({ after: cleanup => onTestFinished(cleanup), diagnostic: message => console.info(message) })
  const owner = session()
  const credentials = { email: 'pwa-permission@example.com', password: 'Pwa-tests-12345' }
  const user = await owner.request<PublicUser>('POST', '/users', 201, { ...credentials, displayName: 'Owner' })
  await owner.request('POST', '/auth/login', 200, credentials)
  const namespace = await app.db.selectFrom('namespaces').selectAll().where('owner_user_id', '=', user.id).executeTakeFirstOrThrow()
  const base = `/namespaces/${namespace.slug}/spaces`
  const space = await owner.request<PublicSpace>('POST', base, 201, { name: 'Private', slug: 'private', type: 'object', app: 'note' })
  const url = `${base}/private/apps/${space.id}/pwa`
  const body = { name: 'Allowed', pwa: { enabled: true, iconObjectId: null, themeColor: null, offlinePolicy: 'shell' }, publishAcknowledged: true }
  const other = session()
  const reader = await other.request<PublicUser>('POST', '/users', 201, { email: 'pwa-reader@example.com', password: credentials.password, displayName: 'Reader' })
  await other.request('POST', '/auth/login', 200, { email: reader.email, password: credentials.password })
  await other.request('PUT', url, 403, body)
  await app.db.insertInto('namespace_members').values({ namespace_id: namespace.id, user_id: reader.id, role: 'member' }).execute()
  await app.db.insertInto('space_members').values({ space_id: space.id, user_id: reader.id, role: 'reader' }).execute()
  for (const role of ['reader', 'writer'] as const) {
    await app.db.updateTable('space_members').set({ role }).where('space_id', '=', space.id).where('user_id', '=', reader.id).execute()
    await other.request('PUT', url, 403, body)
  }
  await app.db.updateTable('space_members').set({ role: 'writer' }).where('space_id', '=', space.id).where('user_id', '=', user.id).execute()
  await app.db.updateTable('space_members').set({ role: 'owner' }).where('space_id', '=', space.id).where('user_id', '=', reader.id).execute()
  await other.request('PUT', url, 200, body)
  await app.db.updateTable('users').set({ is_disabled: true }).where('id', '=', reader.id).execute()
  await other.request('PUT', url, 401, body)
  // A namespace owner retains management rights without a Space owner row.
  await owner.request('PUT', url, 200, body)
})
