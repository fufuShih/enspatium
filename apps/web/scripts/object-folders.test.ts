import { expect, test, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { getBrowseObjectsQueryKey, getListObjectsQueryKey, getGetObjectStorageUsageQueryKey, getListObjectVersionsQueryKey, getGetObjectHeadQueryKey } from '../src/api/generated/objects.ts'
import { objectBreadcrumbs, objectFolderLocation, newObjectFolder } from '../src/pages/SpacesPage/object/objectFolderApi.ts'
import { uploadFile, refreshObjectLists } from '../src/pages/SpacesPage/object/objectFileApi.ts'

test('folder URLs and breadcrumbs preserve Unicode, spaces and literal percent characters', () => {
  const path = '中文😀/a %_#/'
  const url = new URL(objectFolderLocation('my team', 'files', path, 'a%_', path + 'next.txt'), 'https://example.test')
  expect(url.pathname).toBe('/my%20team/files')
  expect(url.searchParams.get('path')).toBe(path)
  expect(url.searchParams.get('filter')).toBe('a%_')
  expect(url.searchParams.get('cursor')).toBe(path + 'next.txt')
  expect(objectBreadcrumbs(path)).toEqual([{ name: '中文😀', prefix: '中文😀/' }, { name: 'a %_#', prefix: path }])
  expect(objectFolderLocation('owner', 'files')).toBe('/owner/files')
})

test('new folder names reject traversal and unsupported segments', () => {
  expect(newObjectFolder('docs/', '中文😀')).toBe('docs/中文😀/')
  for (const name of ['', '.', '..', '../other', 'sub/folder', 'bad\\name', 'end.', 'end ', 'nul.txt', 'a:b']) expect(newObjectFolder('docs/', name)).toBeNull()
})

test('uploads preserve raw bytes and use the full current folder key', async () => {
  const file = new File(['Nested contents'], 'same name.txt', { type: 'text/plain' })
  const signal = new AbortController().signal
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    if (options?.method === 'GET') return Response.json(null)
    expect(String(url)).toContain('/objects/' + encodeURIComponent('docs/中文/same name.txt'))
    expect(options?.body).toBe(file)
    expect(options?.signal).toBe(signal)
    return Response.json({ key: 'docs/中文/same name.txt' }, { status: 201 })
  })
  await uploadFile('owner', 'files', file, signal, 'docs/中文/')
})

test('file mutations invalidate ancestor folder listings, flat lists and storage usage', async () => {
  const client = new QueryClient()
  const changed = [
    getBrowseObjectsQueryKey('owner', 'files', { prefix: '' }),
    getBrowseObjectsQueryKey('owner', 'files', { prefix: 'docs/', cursor: 'docs/a.txt' }),
    getListObjectsQueryKey('owner', 'files'), getGetObjectStorageUsageQueryKey('owner', 'files'),
    getBrowseObjectsQueryKey('owner', 'files', { deleted: true }),
    getListObjectVersionsQueryKey('owner', 'files', { key: 'docs/a.txt', cursor: 20 }),
    getGetObjectHeadQueryKey('owner', 'files', { key: 'docs/a.txt' }),
  ]
  const other = getBrowseObjectsQueryKey('owner', 'other')
  try {
    for (const key of [...changed, other]) client.setQueryData(key, {})
    await refreshObjectLists(client, 'owner', 'files')
    for (const key of changed) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    expect(client.getQueryState(other)?.isInvalidated).toBe(false)
  } finally { client.clear() }
})
