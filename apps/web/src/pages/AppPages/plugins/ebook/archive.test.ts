import { expect, test } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { maxEpubBytes, unpackEpub } from './archive'

test('extracts a small archive and rejects invalid or excessive EPUB content', () => {
  const content = strToU8('<p>A chapter</p>')
  expect(unpackEpub(zipSync({ 'book/chapter.xhtml': content }))['book/chapter.xhtml']).toEqual(content)
  expect(() => unpackEpub(new Uint8Array())).toThrow('not a valid EPUB')
  expect(() => unpackEpub(new Uint8Array(maxEpubBytes + 1))).toThrow('20 MiB')
  expect(() => unpackEpub(zipSync({ 'huge.txt': new Uint8Array(11 * 1024 * 1024) }))).toThrow('too large')
  expect(() => unpackEpub(zipSync(Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`${i}.txt`, content]))))).toThrow('too large')
  for (const path of ['../secret', '/secret', 'folder\\secret']) {
    expect(() => unpackEpub(zipSync(Object.fromEntries([[path, content]])))).toThrow('invalid archive paths')
  }
  const poisoned = zipSync({ safenamex: content }, { level: 0 })
  const name = strToU8('safenamex')
  for (let offset = 0; offset < poisoned.length - name.length; offset++) {
    if (name.every((byte, index) => poisoned[offset + index] === byte)) poisoned.set(strToU8('__proto__'), offset)
  }
  expect(() => unpackEpub(poisoned)).toThrow('invalid archive paths')
})
