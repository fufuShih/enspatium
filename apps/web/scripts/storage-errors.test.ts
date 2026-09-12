import { expect, test } from 'vitest'
import { fileErrorMessage } from '../src/pages/SpacesPage/object/objectFileApi.ts'
import { gitErrorMessage } from '../src/pages/SpacesPage/git/gitBrowserApi.ts'
import { storageErrorTitle } from '../src/pages/SpacesPage/shared/storageErrors.ts'
import { QueryClient } from '@tanstack/react-query'
import { clearDeletedSpace } from '../src/pages/SpacesPage/shared/spaceApi.ts'

test('missing content and unavailable storage are distinguished from missing metadata and network errors', () => {
  const unavailable = { status: 503, info: { code: 'SPACE_STORAGE_UNAVAILABLE' } }
  const missing = { status: 404, info: { code: 'OBJECT_CONTENT_MISSING' } }
  expect(fileErrorMessage({ status: 409, info: { code: 'OBJECT_CONTENT_CORRUPT' } }, 'restore')).toMatch(/current version was kept/)
  expect(storageErrorTitle(unavailable, 'Failed')).toBe('Storage unavailable')
  expect(gitErrorMessage(unavailable)).toMatch(/records have been kept/)
  expect(fileErrorMessage(unavailable, 'upload')).toMatch(/Restore storage/)
  expect(storageErrorTitle(missing, 'Failed')).toBe('File content missing')
  expect(fileErrorMessage(missing, 'preview')).toMatch(/Other files are still available/)
  expect(storageErrorTitle({ status: 503 }, 'Failed')).toBe('Failed')
  expect(storageErrorTitle({ status: 404 }, 'Space not found')).toBe('Space not found')
})

test('deleting a Space clears its content caches without removing another Space', async () => {
  const client = new QueryClient()
  const endpoint = '/api/namespaces/owner/spaces/demo'
  client.setQueryData([endpoint, 'user'], { name: 'demo' })
  client.setQueryData([endpoint + '/git/tree', 'user'], { entries: [] })
  client.setQueryData([endpoint + '/objects', 'user'], [])
  client.setQueryData([endpoint + '-other', 'user'], { name: 'other' })
  client.setQueryData(['/api/namespaces/owner/spaces', 'user'], [])
  await clearDeletedSpace(client, 'owner', 'demo')
  expect(client.getQueryData([endpoint, 'user'])).toBe(undefined)
  expect(client.getQueryData([endpoint + '/git/tree', 'user'])).toBe(undefined)
  expect(client.getQueryData([endpoint + '/objects', 'user'])).toBe(undefined)
  expect(client.getQueryData([endpoint + '-other', 'user'])).toStrictEqual({ name: 'other' })
  expect(client.getQueryState(['/api/namespaces/owner/spaces', 'user'])?.isInvalidated).toBe(true)
  client.clear()
})
