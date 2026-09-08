import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileErrorMessage } from '../src/pages/SpacesPage/objectFileApi.ts'
import { gitErrorMessage } from '../src/pages/SpacesPage/gitBrowserApi.ts'
import { storageErrorTitle } from '../src/pages/SpacesPage/storageErrors.ts'

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
