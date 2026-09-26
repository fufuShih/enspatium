import { expect, test } from 'vitest'
import { createFixture } from './fixture.js'
import type { PublicUser } from '../src/db/types/user.types.js'
import type { PublicSpace } from '../src/db/types/space.types.js'
import type { PublicSpaceObject } from '../src/db/types/object.types.js'
import { createAppInstance, deleteAppInstance, updateAppInstance } from '../src/services/app-instances.js'

test('instance APIs resolve their own Space, share content, and enforce access and version rules on every route', async ({ onTestFinished }) => {
  const { app, session } = await createFixture({ after: cleanup => onTestFinished(cleanup), diagnostic: message => console.info(message) })
  const owner = session()
  const credentials = { email: 'instance-routes@example.com', password: 'Apps-test-1234' }
  const user = await owner.request<PublicUser>('POST', '/users', 201, { ...credentials, displayName: 'Owner' })
  await owner.request('POST', '/auth/login', 200, credentials)
  const namespace = await app.db.selectFrom('namespaces').selectAll().where('owner_user_id', '=', user.id).executeTakeFirstOrThrow()
  const base = `/namespaces/${namespace.slug}/spaces`
  const space = await owner.request<PublicSpace>('POST', base, 201, { name: 'Shared', slug: 'shared', type: 'object', app: 'note' })
  const other = await owner.request<PublicSpace>('POST', base, 201, { name: 'Other', slug: 'other', type: 'object' })
  const args = [app.db, user.id, namespace.slug, space.slug] as const
  const second = await createAppInstance(...args, { appType: 'note', name: 'Second notebook' })
  const media = await createAppInstance(...args, { appType: 'media' })
  const ebook = await createAppInstance(...args, { appType: 'ebook' })
  const api = `/apps/note/instances/${second.id}`
  const original = `/apps/note/instances/${space.id}`
  const mediaApi = `/apps/media/instances/${media.id}`
  const ebookApi = `/apps/ebook/instances/${ebook.id}`
  expect(second.id).not.toBe(space.id)
  const details = await owner.request('GET', api)
  expect(details).toMatchObject({ id: second.id, spaceId: space.id, name: 'Second notebook', account: namespace.slug, slug: space.slug,
    app: { type: 'note', storageType: 'object' }, config: {}, pwa: { enabled: false, offlinePolicy: 'shell' } })
  expect(details).not.toHaveProperty('storage_type')
  await owner.request('GET', `/apps/media/instances/${second.id}`, 404)
  await owner.request('GET', `/apps/media/instances/${space.id}`, 404)
  await owner.request('GET', '/apps/note/instances/not-a-uuid', 400)
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: credentials })
  const cookies = login.headers['set-cookie']
  const cookie = (Array.isArray(cookies) ? cookies : [String(cookies)]).map(value => value.split(';')[0]).join('; ')
  async function upload(slug: string, key: string, contentType: string, payload: string) {
    const result = await app.inject({ method: 'PUT', url: `${base}/${slug}/objects/${encodeURIComponent(key)}`, headers: { cookie, 'content-type': contentType }, payload })
    expect(result.statusCode).toBe(201)
    return result.json<PublicSpaceObject>()
  }
  const note = await upload(space.slug, 'note.md', 'text/markdown', '# Shared note')
  const image = await upload(space.slug, 'photo.png', 'image/png', 'image bytes')
  const book = await upload(space.slug, 'book.pdf', 'application/pdf', 'book bytes')
  const foreign = await upload(other.slug, 'note.md', 'text/markdown', '# Other Space')
  const stream = (file: PublicSpaceObject) => `${api}/objects/content?` + new URLSearchParams({ key: file.key, versionId: file.versionId })
  const urls = [api, api + '/objects', api + '/objects/' + note.id, stream(note)]
  for (const url of urls) {
    const response = await app.inject({ url, headers: { cookie } })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toContain('no-store')
    expect((await app.inject(url)).statusCode).toBe(401)
  }
  const outsider = session()
  const member = await outsider.request<PublicUser>('POST', '/users', 201, { email: 'instance-reader@example.com', password: credentials.password, displayName: 'Reader' })
  await outsider.request('POST', '/auth/login', 200, { email: member.email, password: credentials.password })
  for (const url of urls.slice(0, 3)) await outsider.request('GET', url, 403)
  await app.db.insertInto('namespace_members').values({ namespace_id: namespace.id, user_id: member.id, role: 'member' }).execute()
  await app.db.insertInto('space_members').values({ space_id: space.id, user_id: member.id, role: 'reader' }).execute()
  expect(await outsider.request('GET', api + '/objects')).toMatchObject({ canUpload: false, objects: [{ id: note.id }] })
  await app.db.deleteFrom('space_members').where('space_id', '=', space.id).where('user_id', '=', member.id).execute()
  for (const url of urls.slice(0, 3)) await outsider.request('GET', url, 403)
  expect(await owner.request('GET', api + '/objects')).toMatchObject({ canUpload: true, objects: [{ id: note.id, kind: 'markdown' }] })
  expect(await owner.request('GET', original + '/objects')).toEqual(await owner.request('GET', api + '/objects'))
  expect(await owner.request('GET', mediaApi + '/objects')).toMatchObject({ objects: [{ id: image.id, kind: 'image' }] })
  expect(await owner.request('GET', ebookApi + '/objects')).toMatchObject({ objects: [{ id: book.id, kind: 'pdf' }] })
  await owner.request('GET', api + '/objects?kind=video', 400)
  await owner.request('GET', api + '/objects/' + foreign.id, 404)
  await owner.request('GET', api + '/objects/' + image.id, 404)
  await owner.request('GET', api + '/objects/' + foreign.id + '?spaceId=' + other.id, 404)
  expect((await app.inject({ url: stream(foreign), headers: { cookie } })).statusCode).toBe(404)
  expect((await app.inject({ url: stream(image), headers: { cookie } })).statusCode).toBe(404)
  const range = await app.inject({ url: stream(note), headers: { cookie, range: 'bytes=0-3' } })
  expect(range.statusCode).toBe(206)
  expect(range.body).toBe('# Sh')
  const head = await app.inject({ method: 'HEAD', url: stream(note), headers: { cookie, range: 'bytes=0-3' } })
  expect(head.statusCode).toBe(200)
  expect(head.body).toBe('')
  expect(head.headers['content-length']).toBe(String(Buffer.byteLength('# Shared note')))
  expect((await app.inject({ method: 'HEAD', url: stream(note) })).statusCode).toBe(401)
  const updated = await upload(space.slug, 'note.md', 'text/markdown', '# Updated note')
  await owner.request('PATCH', `${base}/${space.slug}`, 200, { visibility: 'public', name: 'Renamed Space' })
  expect(await session().request('GET', api)).toMatchObject({ id: second.id, spaceId: space.id, name: 'Second notebook' })
  expect((await app.inject(stream(updated))).body).toBe('# Updated note')
  expect((await app.inject(stream(note))).statusCode).toBe(404)
  expect((await app.inject({ method: 'HEAD', url: stream(note) })).statusCode).toBe(404)
  expect((await app.inject({ url: stream(note), headers: { cookie } })).body).toBe('# Shared note')
  await owner.request('PATCH', `${base}/${space.slug}`, 200, { visibility: 'private' })
  for (const url of urls) expect((await app.inject(url)).statusCode).toBe(401)
  await updateAppInstance(...args, second.id, { name: 'Renamed instance' })
  expect(await owner.request('GET', api)).toMatchObject({ id: second.id, name: 'Renamed instance', spaceId: space.id })
  await deleteAppInstance(...args, space.id)
  await owner.request('GET', `/apps/note/spaces/${space.id}`, 404)
  await owner.request('GET', `${base}/${space.slug}/note`, 404)
  await owner.request('GET', original, 404)
  expect(await owner.request('GET', api + '/objects')).toMatchObject({ objects: [{ id: updated.id }] })
  await deleteAppInstance(...args, second.id)
  for (const url of urls) expect((await app.inject({ url, headers: { cookie } })).statusCode).toBe(404)
  expect((await app.inject({ url: `${base}/${space.slug}/objects/note.md`, headers: { cookie } })).body).toBe('# Updated note')
  await owner.request('DELETE', `${base}/${space.slug}`, 204)
  await owner.request('GET', mediaApi, 404)
  await owner.request('GET', ebookApi + '/objects', 404)
})
