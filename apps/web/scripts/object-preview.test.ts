import { expect, test } from 'vitest'
import { decodeObjectText, objectFileKind, objectPreviewKind } from '../src/pages/SpacesPage/objectPreview.ts'

test('active document formats are shown as text, never embedded as a document', () => {
  expect(objectPreviewKind({ key: 'page.html', contentType: 'text/html' })).toBe('text')
  expect(objectPreviewKind({ key: 'image.svg', contentType: 'image/svg+xml' })).toBe('text')
  expect(objectPreviewKind({ key: 'photo.png', contentType: 'image/png' })).toBe('image')
  expect(objectPreviewKind({ key: 'readme.md', contentType: 'application/octet-stream' })).toBe('text')
  expect(objectPreviewKind({ key: 'data.json', contentType: 'application/problem+json' })).toBe('text')
  expect(objectPreviewKind({ key: 'report.pdf', contentType: 'application/pdf' })).toBe(null)
  expect(objectFileKind({ key: 'report.pdf', contentType: 'application/pdf' })).toBe('pdf')
  expect(objectFileKind({ key: 'backup.zip', contentType: 'application/octet-stream' })).toBe('archive')
})

test('text decoding preserves empty files and Unicode, supports Windows UTF-16 and rejects binary data', () => {
  const bytes = (value: number[]) => new Uint8Array(value).buffer
  expect(decodeObjectText(new TextEncoder().encode('Hello 世界').buffer)).toBe('Hello 世界')
  expect(decodeObjectText(bytes([]))).toBe('')
  expect(decodeObjectText(bytes([255, 254, 65, 0]))).toBe('A')
  expect(decodeObjectText(bytes([254, 255, 0, 65]))).toBe('A')
  expect(() => decodeObjectText(bytes([0, 1, 2]))).toThrow()
  expect(() => decodeObjectText(bytes([255, 255]))).toThrow()
})
