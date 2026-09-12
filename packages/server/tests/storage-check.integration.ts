import { test, expect, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { sql } from 'kysely'
import type { PublicNamespace } from '../src/db/namespace.types.js'
import type { PublicSpace } from '../src/db/space.types.js'
import type { PublicSpaceObject } from '../src/db/object.types.js'
import { checkStorage } from '../src/services/storage-check/index.js'
import type { StorageCheckReport } from '../src/services/storage-check/report.js'
import * as inspectionFiles from '../src/services/storage-check/filesystem.js'
import * as objectFiles from '../src/services/object/storage.js'
import {
  cleanupObjectSpace,
  cleanupObjectVersions,
} from '../src/services/object/retention.js'
import { acquireStorageWrite } from '../src/services/space/storage-access.js'
import { createFixture } from './fixture.js'

async function fileSnapshot(root: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {}
  async function visit(path: string) {
    const stat = await lstat(path)
    const key = relative(root, path)
    if (stat.isSymbolicLink()) snapshot[key] = 'link:' + (await readlink(path))
    else if (stat.isDirectory()) {
      snapshot[key] = 'directory'
      for (const name of (await readdir(path)).sort())
        await visit(join(path, name))
    } else
      snapshot[key] = createHash('sha256')
        .update(await readFile(path))
        .digest('hex')
  }
  await visit(root)
  return snapshot
}

test('Object inspection reconciles all retained versions without changing data and the admin API reports findings', async ({
  onTestFinished,
}) => {
  const fixture = await createFixture({
    after: (cleanup) => onTestFinished(cleanup),
    diagnostic: (message) => console.info(message),
  })
  const { app, root, session } = fixture
  const owner = session()
  const credentials = {
    email: 'inspector@example.com',
    password: 'Inspector-test-1234',
  }
  await owner.request('POST', '/users', 201, {
    ...credentials,
    displayName: 'Inspector',
    is_admin: true,
    isAdmin: true,
  })
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: credentials,
  })
  const cookies = login.headers['set-cookie']
  const cookie = (Array.isArray(cookies) ? cookies : [String(cookies)])
    .map((value) => value.split(';')[0])
    .join('; ')
  await owner.request('POST', '/auth/login', 200, credentials)
  const namespace = (
    await owner.request<PublicNamespace[]>('GET', '/namespaces')
  )[0]!.slug
  const space = await owner.request<PublicSpace>(
    'POST',
    `/namespaces/${namespace}/spaces`,
    201,
    { name: 'Objects', slug: 'objects', type: 'object' },
  )
  const base = `/namespaces/${namespace}/spaces/objects`
  const dataRoot = join(root, 'data')
  const spaceRoot = join(dataRoot, space.id)
  async function upload(key: string, bytes: string) {
    const response = await app.inject({
      method: 'PUT',
      url: base + '/objects/' + key,
      headers: { cookie, 'content-type': 'text/plain' },
      payload: bytes,
    })
    expect(response.statusCode, response.body).toBe(201)
    return response.json<PublicSpaceObject>()
  }
  const old = await upload('note.txt', 'before')
  const current = await upload('note.txt', 'latest')
  const deleted = await upload('deleted.txt', 'retained')
  await owner.request('DELETE', base + '/objects/deleted.txt', 204)
  const legacy = await upload('legacy.txt', 'nested')
  await mkdir(join(spaceRoot, 'nested'))
  await rename(
    join(spaceRoot, legacy.versionId),
    join(spaceRoot, 'nested', 'legacy.txt'),
  )
  await app.db
    .updateTable('space_object_versions')
    .set({ storage_key: 'nested/legacy.txt' })
    .where('id', '=', legacy.versionId)
    .execute()
  // Exercise pagination beyond one query batch, including empty content hashes.
  for (let i = 0; i < 101; i++) await upload('page-' + i + '.txt', '')

  const adminId = login.json<{ id: string }>().id
  expect(
    await app.db
      .selectFrom('users')
      .select('is_admin')
      .where('id', '=', adminId)
      .executeTakeFirst(),
  ).toEqual({ is_admin: false })
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/admin/storage/check',
        payload: {},
      })
    ).statusCode,
  ).toBe(401)
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/admin/storage/check',
        headers: { cookie },
        payload: {},
      })
    ).statusCode,
  ).toBe(403)
  await app.db
    .updateTable('users')
    .set({ is_admin: true })
    .where('id', '=', adminId)
    .execute()
  async function apiCheck(body: { spaceId?: string; deep?: boolean } = {}) {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/storage/check',
      headers: { cookie },
      payload: body,
    })
    expect(response.statusCode, response.body).toBe(200)
    expect(response.headers['cache-control']).toBe('private, no-store')
    return response.json<StorageCheckReport>()
  }
  async function snapshot() {
    return {
      files: await fileSnapshot(dataRoot),
      objects: await app.db
        .selectFrom('space_objects')
        .selectAll()
        .orderBy('id')
        .execute(),
      versions: await app.db
        .selectFrom('space_object_versions')
        .selectAll()
        .orderBy('id')
        .execute(),
      spaces: await app.db
        .selectFrom('spaces')
        .selectAll()
        .orderBy('id')
        .execute(),
      audits: await app.db
        .selectFrom('audit_events')
        .selectAll()
        .orderBy('id')
        .execute(),
    }
  }
  async function scan(deep = true) {
    const before = await snapshot()
    const report = await apiCheck({ deep })
    expect(await snapshot()).toEqual(before)
    return report
  }
  let report = await scan()
  expect(report.status, JSON.stringify(report.issues)).toBe('ok')
  expect(report.spaces[0]).toMatchObject({
    objects: 104,
    versions: 106,
    filesChecked: 105,
    hashesChecked: 105,
    versionBytes: '26',
  })
  const apiBefore = await snapshot()
  expect(await apiCheck({ spaceId: space.id, deep: true })).toMatchObject({
    status: 'ok',
    mode: 'deep',
    scope: space.id,
    complete: true,
    consistency: 'service-writes-paused',
  })
  expect(await snapshot()).toEqual(apiBefore)

  await writeFile(join(spaceRoot, current.versionId), 'edited')
  expect((await scan(false)).status).toBe('ok')
  report = await scan()
  expect(report.issues).toEqual([
    expect.objectContaining({
      code: 'OBJECT_CHECKSUM_MISMATCH',
      versionId: current.versionId,
    }),
  ])
  await writeFile(join(spaceRoot, current.versionId), 'longer content')
  expect((await scan(false)).issues).toContainEqual(
    expect.objectContaining({
      code: 'OBJECT_SIZE_MISMATCH',
      versionId: current.versionId,
    }),
  )
  await writeFile(join(spaceRoot, current.versionId), 'latest')

  await rename(join(spaceRoot, old.versionId), join(spaceRoot, 'moved.bin'))
  await writeFile(
    join(spaceRoot, '.interrupted.' + randomUUID() + '.upload'),
    'partial',
  )
  await mkdir(join(dataRoot, randomUUID()))
  report = await scan()
  expect(report.issues.map((i) => i.code)).toEqual(
    expect.arrayContaining([
      'OBJECT_CONTENT_MISSING',
      'UNREFERENCED_FILE',
      'TEMPORARY_FILE',
      'UNREGISTERED_ENTRY',
    ]),
  )
  expect((await apiCheck()).status).toBe('issues')
  const scoped = await apiCheck({ spaceId: space.id })
  expect(scoped.issues.some((i) => i.code === 'OBJECT_CONTENT_MISSING')).toBe(
    true,
  )
  expect(scoped.issues.some((i) => i.code === 'UNREGISTERED_ENTRY')).toBe(false)

  // A purge may have removed bytes before its final metadata transaction failed.
  await app.db
    .updateTable('space_object_versions')
    .set({ purge_started_at: new Date() })
    .where('id', '=', old.versionId)
    .execute()
  report = await scan()
  expect(report.issues).toContainEqual(
    expect.objectContaining({
      code: 'PURGE_PENDING',
      versionId: old.versionId,
    }),
  )
  expect(
    report.issues.some(
      (i) =>
        i.code === 'OBJECT_CONTENT_MISSING' && i.versionId === old.versionId,
    ),
  ).toBe(false)
  // Deleted-file history still needs bytes, unlike its zero-byte deletion marker.
  await rm(join(spaceRoot, deleted.versionId))
  expect((await scan()).issues).toContainEqual(
    expect.objectContaining({
      code: 'OBJECT_CONTENT_MISSING',
      versionId: deleted.versionId,
    }),
  )
  await app.db
    .updateTable('space_objects')
    .set({ size_bytes: 999 })
    .where('id', '=', current.id)
    .execute()
  expect((await scan()).issues).toContainEqual(
    expect.objectContaining({
      code: 'OBJECT_HEAD_MISMATCH',
      objectId: current.id,
    }),
  )

  const external = join(root, 'outside-data')
  await mkdir(external)
  await writeFile(join(external, 'untouched.txt'), 'outside')
  await symlink(
    external,
    join(spaceRoot, 'external-link'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  const linked = await apiCheck({ deep: true })
  expect(linked.status).toBe('incomplete')
  expect(linked.issues).toContainEqual(
    expect.objectContaining({ code: 'UNSAFE_PATH' }),
  )
  expect(await readFile(join(external, 'untouched.txt'), 'utf8')).toBe(
    'outside',
  )
  const unavailableRoot = join(root, 'does-not-exist')
  expect((await checkStorage(app.db, unavailableRoot)).issues).toContainEqual(
    expect.objectContaining({ code: 'DIRECTORY_MISSING' }),
  )
  await expect(lstat(unavailableRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  const invalid = await app.inject({
    method: 'POST',
    url: '/admin/storage/check',
    headers: { cookie },
    payload: { spaceId: '../escape' },
  })
  expect(invalid.statusCode).toBe(400)
  expect(await apiCheck({ spaceId: randomUUID() })).toMatchObject({
    complete: false,
    status: 'incomplete',
  })
  await app.db
    .updateTable('users')
    .set({ is_admin: false })
    .where('id', '=', adminId)
    .execute()
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/admin/storage/check',
        headers: { cookie },
        payload: {},
      })
    ).statusCode,
  ).toBe(403)
})

test('Git inspection accepts empty and packed repositories, reports bad HEAD and content, and stays read-only', async ({
  onTestFinished,
}) => {
  const { app, root, git, session } = await createFixture({
    after: (cleanup) => onTestFinished(cleanup),
    diagnostic: (message) => console.info(message),
  })
  const owner = session()
  const credentials = {
    email: 'git-check@example.com',
    password: 'Inspector-test-1234',
  }
  await owner.request('POST', '/users', 201, {
    ...credentials,
    displayName: 'Git inspector',
  })
  await owner.request('POST', '/auth/login', 200, credentials)
  const namespace = (
    await owner.request<PublicNamespace[]>('GET', '/namespaces')
  )[0]!.slug
  const create = (slug: string) =>
    owner.request<PublicSpace>('POST', `/namespaces/${namespace}/spaces`, 201, {
      name: slug,
      slug,
      type: 'git',
    })
  const empty = await create('empty')
  const packed = await create('packed')
  const dataRoot = join(root, 'data')
  const repository = join(dataRoot, packed.id)
  const working = join(root, 'working')
  await git(['init', '--initial-branch=main', working])
  await writeFile(join(working, 'README.md'), 'hello')
  await git(['-C', working, 'add', '.'])
  await git(['-C', working, 'commit', '-m', 'initial'])
  await git(['-C', working, 'push', repository, 'main'])
  await git(['--git-dir', repository, 'gc'])
  await git(['--git-dir', repository, 'pack-refs', '--all'])
  async function scan(deep = true) {
    const before = await fileSnapshot(dataRoot)
    const report = await checkStorage(app.db, dataRoot, { deep })
    expect(await fileSnapshot(dataRoot)).toEqual(before)
    return report
  }
  const initial = await scan()
  expect(initial.status, JSON.stringify(initial.issues)).toBe('ok')
  // A dangling blob is valid content, not repository corruption.
  const source = join(root, 'unreferenced.txt')
  await writeFile(source, 'orphan blob')
  const hash = (
    await git(['--git-dir', repository, 'hash-object', '-w', source])
  ).stdout.trim()
  let report = await scan()
  expect(report.status).toBe('ok')
  expect(report.issues).toContainEqual(
    expect.objectContaining({ code: 'GIT_DANGLING_OBJECTS', severity: 'info' }),
  )
  await git([
    '--git-dir',
    repository,
    'symbolic-ref',
    'HEAD',
    'refs/heads/missing',
  ])
  expect((await scan(false)).issues).toContainEqual(
    expect.objectContaining({ code: 'GIT_HEAD_MISSING', spaceId: packed.id }),
  )
  await git([
    '--git-dir',
    repository,
    'symbolic-ref',
    'HEAD',
    'refs/heads/main',
  ])
  const blobPath = join(repository, 'objects', hash.slice(0, 2), hash.slice(2))
  await chmod(blobPath, 0o600)
  await writeFile(blobPath, 'invalid compressed object')
  expect((await scan(false)).status).toBe('ok')
  expect((await scan()).issues).toContainEqual(
    expect.objectContaining({ code: 'GIT_CORRUPT', spaceId: packed.id }),
  )
  const scoped = await checkStorage(app.db, dataRoot, {
    spaceId: empty.id,
    deep: true,
  })
  expect(scoped.status).toBe('ok')
  expect(scoped.spaces.map((s) => s.id)).toEqual([empty.id])
  await writeFile(
    join(repository, 'refs', 'heads', 'broken'),
    '1'.repeat(40) + '\n',
  )
  expect((await scan(false)).issues).toContainEqual(
    expect.objectContaining({ code: 'GIT_INVALID_REFS' }),
  )

  const emptyRoot = join(dataRoot, empty.id)
  await writeFile(
    join(emptyRoot, 'objects', 'info', 'alternates'),
    join(root, 'outside-objects') + '\n',
  )
  report = await scan()
  expect(report.status).toBe('incomplete')
  expect(report.issues).toContainEqual(
    expect.objectContaining({ code: 'GIT_EXTERNAL_STORAGE' }),
  )
  await rm(join(emptyRoot, 'objects', 'info', 'alternates'))
  await git([
    '--git-dir',
    emptyRoot,
    'config',
    'include.path',
    join(root, 'outside-config'),
  ])
  expect((await scan()).issues).toContainEqual(
    expect.objectContaining({ code: 'GIT_UNSUPPORTED_CONFIG' }),
  )
  await git(['--git-dir', emptyRoot, 'config', '--unset', 'include.path'])
  const moved = emptyRoot + '-missing'
  expect(resolve(moved).startsWith(resolve(dataRoot) + sep)).toBe(true)
  await rename(emptyRoot, moved)
  report = await scan()
  expect(report.issues).toContainEqual(
    expect.objectContaining({ code: 'DIRECTORY_MISSING', spaceId: empty.id }),
  )
  expect(
    await app.db
      .selectFrom('spaces')
      .select('id')
      .where('id', '=', empty.id)
      .executeTakeFirst(),
  ).toBeDefined()
  // No migration, cleanup, or audit event is triggered by inspection.
  expect(
    (
      await sql<{
        count: string
      }>`select count(*) from audit_events where action like 'object.%'`.execute(
        app.db,
      )
    ).rows[0]!.count,
  ).toBe('0')
})

test('admin inspection coordinates uploads, Git writes and retention while reads stay available', async ({
  onTestFinished,
}) => {
  const { app, root, session } = await createFixture({
    after: (cleanup) => onTestFinished(cleanup),
    diagnostic: (message) => console.info(message),
  })
  const owner = session()
  const credentials = {
    email: 'admin-check@example.com',
    password: 'Inspector-test-1234',
  }
  await owner.request('POST', '/users', 201, {
    ...credentials,
    displayName: 'Administrator',
  })
  const user = await owner.request<{ id: string }>(
    'POST',
    '/auth/login',
    200,
    credentials,
  )
  await app.db
    .updateTable('users')
    .set({ is_admin: true })
    .where('id', '=', user.id)
    .execute()
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: credentials,
  })
  const cookies = login.headers['set-cookie']
  const cookie = (Array.isArray(cookies) ? cookies : [String(cookies)])
    .map((value) => value.split(';')[0])
    .join('; ')
  const namespace = (
    await owner.request<PublicNamespace[]>('GET', '/namespaces')
  )[0]!.slug
  const space = await owner.request<PublicSpace>(
    'POST',
    `/namespaces/${namespace}/spaces`,
    201,
    { name: 'Files', slug: 'files', type: 'object' },
  )
  await owner.request('POST', `/namespaces/${namespace}/spaces`, 201, {
    name: 'Git',
    slug: 'git',
    type: 'git',
  })
  const base = `/namespaces/${namespace}/spaces/files`
  const dataRoot = join(root, 'data')
  const put = () =>
    app.inject({
      method: 'PUT',
      url: base + '/objects/note.txt',
      headers: { cookie, 'content-type': 'text/plain' },
      payload: 'note',
    })
  const initial = (await put()).json<PublicSpaceObject>()
  const token = await owner.request<{ token: string }>(
    'POST',
    '/auth/tokens',
    201,
    { name: 'Git check', scopes: ['git:read', 'git:write'] },
  )
  const authorization =
    'Basic ' + Buffer.from('git:' + token.token).toString('base64')
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/admin/storage/check',
        headers: { authorization },
        payload: {},
      })
    ).statusCode,
  ).toBe(401)

  let entered!: () => void
  let resume!: () => void
  const reached = new Promise<void>((resolve) => {
    entered = resolve
  })
  const paused = new Promise<void>((resolve) => {
    resume = resolve
  })
  const checksum = inspectionFiles.checksum
  const intercept = vi
    .spyOn(inspectionFiles, 'checksum')
    .mockImplementationOnce(async (...args) => {
      entered()
      await paused
      return checksum(...args)
    })
  const checking = app
    .inject({
      method: 'POST',
      url: '/admin/storage/check',
      headers: { cookie },
      payload: { spaceId: space.id, deep: true },
    })
    .then((response) => response)
  try {
    await Promise.race([
      reached,
      checking.then((response) => {
        throw new Error(
          'Scan finished before coordination check: ' + response.statusCode,
        )
      }),
    ])
    await owner.request('POST', '/admin/storage/check', 409, {})
    expect((await put()).statusCode).toBe(409)
    await owner.request('DELETE', base + '/objects/note.txt', 409)
    await owner.request(
      'POST',
      base +
        '/object-versions/restore?key=note.txt&versionId=' +
        initial.versionId +
        '&expectedVersion=' +
        initial.versionId,
      409,
    )
    await owner.request('DELETE', base, 409)
    await owner.request('POST', `/namespaces/${namespace}/spaces`, 409, {
      name: 'Blocked',
      slug: 'blocked',
      type: 'object',
    })
    await owner.request(
      'PATCH',
      `/namespaces/${namespace}/spaces/git/git/default-branch`,
      409,
      { branch: 'main' },
    )
    const push = await app.inject({
      method: 'POST',
      url: `/git/${namespace}/git.git/git-receive-pack`,
      headers: {
        authorization,
        'content-type': 'application/x-git-receive-pack-request',
      },
      payload: '0000',
    })
    expect(push.statusCode, push.body).toBe(409)
    await expect(
      cleanupObjectSpace(app.db, dataRoot, space.id),
    ).rejects.toMatchObject({ code: 'STORAGE_BUSY' })
    const cleanupError = vi.fn()
    await cleanupObjectVersions(app.db, dataRoot, cleanupError)
    expect(cleanupError).not.toHaveBeenCalled()
    const download = await app.inject({
      method: 'GET',
      url: base + '/objects/note.txt',
      headers: { cookie },
    })
    expect(download.statusCode).toBe(200)
    expect(download.body).toBe('note')
    await owner.request('GET', base + '/objects')
    const refs = await app.inject({
      method: 'GET',
      url: `/git/${namespace}/git.git/info/refs?service=git-upload-pack`,
      headers: { authorization },
    })
    expect(refs.statusCode).toBe(200)
  } finally {
    resume()
    intercept.mockRestore()
  }
  const completed = await checking
  expect(completed.statusCode, completed.body).toBe(200)
  expect(completed.json()).toMatchObject({
    status: 'ok',
    consistency: 'service-writes-paused',
  })
  expect((await put()).statusCode).toBe(201)

  // Bytes are written before the DB transaction; that entire upload must hold the lease.
  let uploaded!: () => void
  let finishUpload!: () => void
  const written = new Promise<void>((resolve) => {
    uploaded = resolve
  })
  const waiting = new Promise<void>((resolve) => {
    finishUpload = resolve
  })
  const write = objectFiles.writeObjectFile
  const slowWrite = vi
    .spyOn(objectFiles, 'writeObjectFile')
    .mockImplementationOnce(async (...args) => {
      const result = await write(...args)
      uploaded()
      await waiting
      return result
    })
  const uploading = put().then((response) => response)
  try {
    await Promise.race([
      written,
      uploading.then((response) => {
        throw new Error('Upload finished too early: ' + response.statusCode)
      }),
    ])
    await owner.request('POST', '/admin/storage/check', 409, {})
  } finally {
    finishUpload()
    slowWrite.mockRestore()
  }
  expect((await uploading).statusCode).toBe(201)

  const cancelled = await checkStorage(
    app.db,
    dataRoot,
    { spaceId: space.id },
    AbortSignal.abort(),
  )
  expect(cancelled.status).toBe('incomplete')
  expect(cancelled.issues[0]?.code).toBe('CHECK_CANCELLED')
  const release = acquireStorageWrite(dataRoot) // Cancellation released the exclusive check.
  release()
  expect(
    (
      await owner.request<StorageCheckReport>(
        'POST',
        '/admin/storage/check',
        200,
        { spaceId: space.id, deep: true },
      )
    ).status,
  ).toBe('ok')
})
