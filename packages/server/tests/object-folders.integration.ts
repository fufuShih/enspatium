import { test, expect } from 'vitest'
import { join } from 'node:path'
import { rename } from 'node:fs/promises'
import { createFixture } from './fixture.js'
import type { PublicUser } from '../src/db/types/user.types.js'
import type { PublicNamespace } from '../src/db/types/namespace.types.js'
import type { PublicSpace } from '../src/db/types/space.types.js'
import type { ObjectFolderPage } from '../src/services/object/object.js'

test('object folders group before pagination, preserve key boundaries and enforce access', async ({ onTestFinished }) => {
  const { origin, root, app, session } = await createFixture({ after: cleanup => onTestFinished(cleanup), diagnostic: message => console.info(message) })
  const owner = session()
  const guest = session()
  const user = await owner.request<PublicUser>('POST', '/users', 201, { email: 'folders@example.com', displayName: 'Folders owner', password: 'Folder-test-1234' })
  const credentials = { email: user.email, password: 'Folder-test-1234' }
  await owner.request('POST', '/auth/login', 200, credentials)
  const login = await fetch(origin + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials) })
  expect(login.status).toBe(200)
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  await login.arrayBuffer()
  const namespaces = await owner.request<PublicNamespace[]>('GET', '/namespaces')
  const base = '/namespaces/' + namespaces.find(item => item.kind === 'personal')!.slug + '/spaces/files'
  const space = await owner.request<PublicSpace>('POST', base.replace(/\/files$/, ''), 201, { name: 'Files', slug: 'files', type: 'object', visibility: 'private' })
  async function upload(key: string, content: string, status = 201) {
    const response = await fetch(origin + base + '/objects/' + encodeURIComponent(key), { method: 'PUT', headers: { cookie, 'content-type': 'text/plain' }, body: content })
    await response.arrayBuffer()
    expect(response.status).toBe(status)
  }
  await upload('docs/readme.txt', 'Docs content')
  await upload('docs/nested/file.txt', 'Nested content')
  await upload('docs-other/not-a-child.txt', 'Other content')
  await upload('中文😀/a%_folder/file.txt', 'Unicode content')
  await upload('中文😀/abc/file.txt', 'Not a literal match')
  await upload('readme.txt', 'Root content')
  await upload('docs', 'Cannot replace folder', 409)
  await upload('readme.txt/child.txt', 'Cannot use file as folder', 409)
  await guest.request('GET', base + '/object-tree', 401)
  // Seed many keys to prove grouping is not limited by the first 100 objects.
  const keys = [...Array.from({ length: 105 }, (_, index) => `many/item-${index}.txt`), ...Array.from({ length: 105 }, (_, index) => `folder-${String(index).padStart(3, '0')}/item.txt`)]
  await app.db.transaction().execute(async tx => {
    const objects = await tx.insertInto('space_objects').values(keys.map(key => ({ space_id: space.id, created_by_user_id: user.id, key, content_type: 'text/plain', size_bytes: 0, checksum_sha256: '0'.repeat(64) }))).returningAll().execute()
    await tx.insertInto('space_object_versions').values(objects.map(object => ({
      id: object.current_version_id, object_id: object.id, space_id: space.id, revision: 1,
      storage_key: object.key, is_deleted: false, content_type: object.content_type,
      size_bytes: 0, checksum_sha256: object.checksum_sha256, created_by_user_id: user.id,
    }))).execute()
  })
  const allFolders: string[] = []
  const allObjects: string[] = []
  let cursor: string | null = null
  do {
    const page: ObjectFolderPage = await owner.request('GET', base + '/object-tree?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''))
    allFolders.push(...page.folders)
    allObjects.push(...page.objects.map(object => object.key))
    cursor = page.nextCursor
  } while (cursor)
  expect(new Set(allFolders).size).toBe(109)
  expect(allFolders).toHaveLength(109)
  expect(allObjects).toEqual(['readme.txt'])
  const docs = await owner.request<ObjectFolderPage>('GET', base + '/object-tree?prefix=docs%2F')
  expect(docs.folders).toEqual(['docs/nested/'])
  expect(docs.objects.map(object => object.key)).toEqual(['docs/readme.txt'])
  const unicode = await owner.request<ObjectFolderPage>('GET', base + '/object-tree?prefix=' + encodeURIComponent('中文😀/') + '&filter=' + encodeURIComponent('a%_'))
  expect(unicode.folders).toEqual(['中文😀/a%_folder/'])
  expect(unicode.objects).toEqual([])
  const empty = await owner.request<ObjectFolderPage>('GET', base + '/object-tree?prefix=empty%2F')
  expect(empty).toMatchObject({ folders: [], objects: [], nextCursor: null })
  for (const query of ['prefix=docs', 'prefix=..%2F', 'prefix=docs%2F&cursor=elsewhere%2F', 'filter=nested%2F', 'limit=101']) await owner.request('GET', base + '/object-tree?' + query, 400)
  await upload('docs/new.txt', 'New upload')
  const download = await fetch(origin + base + '/objects/' + encodeURIComponent('docs/new.txt'), { headers: { cookie } })
  expect(await download.text()).toBe('New upload')
  await owner.request('DELETE', base + '/objects/' + encodeURIComponent('docs/new.txt'), 204)
  expect((await owner.request<ObjectFolderPage>('GET', base + '/object-tree?prefix=docs%2F')).objects.map(object => object.key)).toEqual(['docs/readme.txt'])
  const stranger = session()
  await stranger.request('POST', '/users', 201, { email: 'stranger@example.com', displayName: 'Stranger', password: credentials.password })
  await stranger.request('POST', '/auth/login', 200, { email: 'stranger@example.com', password: credentials.password })
  await stranger.request('GET', base + '/object-tree', 403)
  const storage = join(root, 'data', space.id)
  await rename(storage, storage + '-offline')
  try { await owner.request('GET', base + '/object-tree', 503) } finally { await rename(storage + '-offline', storage) }
})
