import { test, expect } from 'vitest'
import { rename } from 'node:fs/promises'
import { join } from 'node:path'
import { createFixture } from './fixture.js'
import type { PublicSpace } from '../src/db/space.types.js'
import type { PublicSpaceObject } from '../src/db/object.types.js'
import type { PublicUser } from '../src/db/user.types.js'
import type { listAppObjects } from '../src/services/app-objects.js'

test('Media uses Object storage with filtering before pagination and authorizes current and historical content', async ({ onTestFinished }) => {
  const { app, root, session } = await createFixture({ after: cleanup => onTestFinished(cleanup), diagnostic: message => console.info(message) })
  const owner = session()
  const credentials = { email: 'media@example.com', password: 'Media-test-1234' }
  await owner.request('POST', '/users', 201, { ...credentials, displayName: 'Media owner' })
  await owner.request('POST', '/auth/login', 200, credentials)
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: credentials })
  const cookies = login.headers['set-cookie']
  const cookie = (Array.isArray(cookies) ? cookies : [String(cookies)]).map(value => value.split(';')[0]).join('; ')
  await owner.request('POST', '/namespaces', 201, { name: 'Media team', slug: 'media-team' })
  const ns = '/namespaces/media-team'
  const base = ns + '/spaces/library'
  await owner.request('POST', ns + '/spaces', 400, { name: 'Invalid', slug: 'invalid', type: 'git', app: 'media' })
  await owner.request('POST', ns + '/spaces', 400, { name: 'Invalid', slug: 'invalid', type: 'object', app: 'unknown' })
  const space = await owner.request<PublicSpace>('POST', ns + '/spaces', 201, { name: 'Library', slug: 'library', type: 'object', app: 'media' })
  expect(space).toMatchObject({ app: 'media', type: 'object', visibility: 'private' })
  const appUrl = '/apps/media/spaces/' + space.id
  expect(await owner.request('GET', appUrl)).toMatchObject({ id: space.id, name: 'Library', slug: 'library', account: 'media-team' })
  await owner.request('GET', '/apps/media/spaces/not-a-uuid', 400)
  await owner.request('GET', '/apps/media/spaces/00000000-0000-4000-8000-000000000000', 404)
  await owner.request('POST', '/namespaces', 201, { name: 'Second team', slug: 'second-team' })
  const sameName = await owner.request<PublicSpace>('POST', '/namespaces/second-team/spaces', 201, { name: 'Other library', slug: 'library', type: 'object', app: 'media' })
  expect(await owner.request('GET', '/apps/media/spaces/' + sameName.id)).toMatchObject({ id: sameName.id, name: 'Other library', account: 'second-team' })
  expect(await owner.request('GET', appUrl)).toMatchObject({ id: space.id, account: 'media-team' })
  const plain = await owner.request<PublicSpace>('POST', ns + '/spaces', 201, { name: 'Files', slug: 'files', type: 'object' })
  expect(plain.app).toBeNull()
  await owner.request('GET', '/apps/media/spaces/' + plain.id, 404)
  await owner.request('GET', ns + '/spaces/files/media', 404)
  await expect(app.db.updateTable('spaces').set({ type: 'git' }).where('id', '=', space.id).execute()).rejects.toMatchObject({ code: '23503' })

  async function upload(key: string, contentType: string, content = 'media bytes') {
    const response = await app.inject({ method: 'PUT', url: base + '/objects/' + encodeURIComponent(key), headers: { cookie, 'content-type': contentType }, payload: content })
    expect(response.statusCode, response.body).toBe(201)
    return response.json<PublicSpaceObject>()
  }
  const list = (query = '') => owner.request<Awaited<ReturnType<typeof listAppObjects>>>('GET', base + '/media' + query)
  expect(await list()).toMatchObject({ objects: [], canUpload: true, nextCursor: null })
  for (let index = 0; index < 101; index++) await upload(`a-${index}.txt`, 'text/plain')
  await upload('a-script.svg', 'image/svg+xml', '<svg/>')
  const first = await upload('music/100%_song.mp3', 'audio/mpeg', 'first bytes')
  expect(await owner.request('GET', base + '/media/' + first.id)).toMatchObject({ id: first.id, kind: 'audio' })
  const notMedia = await upload('not-media.txt', 'text/plain')
  expect((await app.inject({ url: base + '/media/content?' + new URLSearchParams({ key: notMedia.key, versionId: notMedia.versionId }), headers: { cookie } })).statusCode).toBe(404)
  await upload('music/100XXsong.mp3', 'audio/mpeg')
  const photo = await upload('photos/photo.png', 'image/png')
  await upload('videos/clip.mp4', 'video/mp4')
  await upload('videos/clip.webm', 'video/webm')
  const page = await list('?limit=2')
  expect(page.objects.map(item => item.kind)).toEqual(['audio', 'audio'])
  expect(page.nextCursor).toBe('music/100XXsong.mp3')
  const second = await list('?limit=2&cursor=' + encodeURIComponent(page.nextCursor!))
  expect(second.objects.map(item => item.kind)).toEqual(['image', 'video'])
  expect((await list('?kind=video')).objects).toHaveLength(2)
  expect((await list('?search=' + encodeURIComponent('100%_'))).objects.map(item => item.key)).toEqual([first.key])
  expect((await list('?search=photos')).objects).toHaveLength(0) // Searches filenames, not directories.
  for (const query of ['?kind=unknown', '?limit=0', '?limit=101']) await owner.request('GET', base + '/media' + query, 400)

  const contentUrl = (object: PublicSpaceObject) => base + '/media/content?' + new URLSearchParams({ key: object.key, versionId: object.versionId })
  const member = session()
  const memberUser = await member.request<PublicUser>('POST', '/users', 201, { email: 'media-reader@example.com', password: credentials.password, displayName: 'Reader' })
  await member.request('POST', '/auth/login', 200, { email: memberUser.email, password: credentials.password })
  await owner.request('POST', ns + '/members', 201, { email: memberUser.email })
  await member.request('GET', base + '/media', 403)
  await member.request('GET', appUrl, 403)
  await owner.request('POST', base + '/members', 201, { email: memberUser.email, role: 'reader' })
  expect(await member.request('GET', base + '/media')).toMatchObject({ canUpload: false })
  expect(await member.request('GET', appUrl)).toMatchObject({ id: space.id })
  await owner.request('PATCH', base + '/members/' + memberUser.id, 200, { role: 'writer' })
  expect(await member.request('GET', base + '/media')).toMatchObject({ canUpload: true })
  await owner.request('DELETE', base + '/members/' + memberUser.id, 204)
  await member.request('GET', base + '/media', 403)

  const guest = session()
  await guest.request('GET', appUrl, 401)
  await guest.request('GET', base + '/media', 401)
  await owner.request('PATCH', base, 200, { visibility: 'public' })
  expect(await guest.request('GET', appUrl)).toMatchObject({ id: space.id })
  expect((await app.inject(appUrl)).headers['cache-control']).toBe('private, no-store')
  expect(await guest.request('GET', base + '/media')).toMatchObject({ canUpload: false, objects: expect.any(Array) })
  const range = await app.inject({ url: contentUrl(first), headers: { range: 'bytes=0-4' } })
  expect(range.statusCode).toBe(206)
  expect(range.body).toBe('first')
  expect(range.headers['cache-control']).toBe('private, no-store')
  expect((await app.inject({ method: 'HEAD', url: contentUrl(first) })).headers['content-length']).toBe('11')
  const updated = await upload(first.key, 'audio/mpeg', 'second bytes')
  expect((await app.inject({ url: contentUrl(first), headers: { range: 'bytes=0-1' } })).statusCode).toBe(404)
  expect((await app.inject({ url: contentUrl(first), headers: { cookie, range: 'bytes=0-4' } })).body).toBe('first')
  expect((await app.inject({ url: contentUrl(updated), headers: { range: 'bytes=0-5' } })).body).toBe('second')
  await owner.request('DELETE', base + '/objects/' + encodeURIComponent(photo.key), 204)
  expect((await list('?kind=image')).objects).toEqual([])
  expect((await app.inject(contentUrl(photo))).statusCode).toBe(404)
  await owner.request('POST', base + '/object-versions/restore?' + new URLSearchParams({ key: photo.key, versionId: photo.versionId,
    expectedVersion: (await owner.request<PublicSpaceObject>('GET', base + '/object-head?key=' + encodeURIComponent(photo.key))).versionId }), 201)
  expect((await list('?kind=image')).objects).toHaveLength(1)
  await app.db.updateTable('space_object_versions').set({ purge_started_at: new Date() }).where('id', '=', first.versionId).execute()
  expect((await app.inject({ url: contentUrl(first), headers: { cookie } })).statusCode).toBe(404)
  await owner.request('PATCH', base, 200, { visibility: 'private' })
  await guest.request('GET', appUrl, 401)
  for (const method of ['GET', 'HEAD'] as const) {
    const denied = await app.inject({ method, url: contentUrl(updated), headers: { range: 'bytes=999-' } })
    expect(denied.statusCode).toBe(401)
    expect(denied.headers['content-range']).toBeUndefined()
  }
  await guest.request('GET', base + '/media', 401)
  await rename(join(root, 'data', space.id), join(root, 'data', space.id + '-missing'))
  await owner.request('GET', base + '/media', 503)
})
