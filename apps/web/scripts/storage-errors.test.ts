import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileErrorMessage } from '../src/pages/SpacesPage/objectFileApi.ts'
import { gitErrorMessage } from '../src/pages/SpacesPage/gitBrowserApi.ts'
import { storageErrorTitle } from '../src/pages/SpacesPage/storageErrors.ts'
import { QueryClient } from '@tanstack/react-query'
import { clearDeletedSpace } from '../src/pages/SpacesPage/spaceApi.ts'

test('missing content and unavailable storage are distinguished from missing metadata and network errors', () => {
  const unavailable = { status: 503, info: { code: 'SPACE_STORAGE_UNAVAILABLE' } }
  const missing = { status: 404, info: { code: 'OBJECT_CONTENT_MISSING' } }
  assert.equal(storageErrorTitle(unavailable, 'Failed'), 'Storage unavailable')
  assert.match(gitErrorMessage(unavailable), /records have been kept/)
  assert.match(fileErrorMessage(unavailable, 'upload'), /Restore storage/)
  assert.equal(storageErrorTitle(missing, 'Failed'), 'File content missing')
  assert.match(fileErrorMessage(missing, 'preview'), /Other files are still available/)
  assert.equal(storageErrorTitle({ status: 503 }, 'Failed'), 'Failed')
  assert.equal(storageErrorTitle({ status: 404 }, 'Space not found'), 'Space not found')
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
  assert.equal(client.getQueryData([endpoint, 'user']), undefined)
  assert.equal(client.getQueryData([endpoint + '/git/tree', 'user']), undefined)
  assert.equal(client.getQueryData([endpoint + '/objects', 'user']), undefined)
  assert.deepEqual(client.getQueryData([endpoint + '-other', 'user']), { name: 'other' })
  assert.equal(client.getQueryState(['/api/namespaces/owner/spaces', 'user'])?.isInvalidated, true)
  client.clear()
})
