import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeObjectText, objectFileKind, objectPreviewKind } from '../src/pages/SpacesPage/objectPreview.ts'

test('active document formats are shown as text, never embedded as a document', () => {
  assert.equal(objectPreviewKind({ key: 'page.html', contentType: 'text/html' }), 'text')
  assert.equal(objectPreviewKind({ key: 'image.svg', contentType: 'image/svg+xml' }), 'text')
  assert.equal(objectPreviewKind({ key: 'photo.png', contentType: 'image/png' }), 'image')
  assert.equal(objectPreviewKind({ key: 'readme.md', contentType: 'application/octet-stream' }), 'text')
  assert.equal(objectPreviewKind({ key: 'data.json', contentType: 'application/problem+json' }), 'text')
  assert.equal(objectPreviewKind({ key: 'report.pdf', contentType: 'application/pdf' }), null)
  assert.equal(objectFileKind({ key: 'report.pdf', contentType: 'application/pdf' }), 'pdf')
  assert.equal(objectFileKind({ key: 'backup.zip', contentType: 'application/octet-stream' }), 'archive')
})

test('text decoding preserves empty files and Unicode, supports Windows UTF-16 and rejects binary data', () => {
  const bytes = (value: number[]) => new Uint8Array(value).buffer
  assert.equal(decodeObjectText(new TextEncoder().encode('Hello 世界').buffer), 'Hello 世界')
  assert.equal(decodeObjectText(bytes([])), '')
  assert.equal(decodeObjectText(bytes([255, 254, 65, 0])), 'A')
  assert.equal(decodeObjectText(bytes([254, 255, 0, 65])), 'A')
  assert.throws(() => decodeObjectText(bytes([0, 1, 2])))
  assert.throws(() => decodeObjectText(bytes([255, 255])))
})
