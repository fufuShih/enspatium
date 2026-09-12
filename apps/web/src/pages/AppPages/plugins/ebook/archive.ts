import { unzipSync } from 'fflate'

export const maxEpubBytes = 20 * 1024 * 1024

export function unpackEpub(bytes: Uint8Array) {
  if (bytes.byteLength < 22) throw new Error('This file is not a valid EPUB.')
  if (bytes.byteLength > maxEpubBytes) throw new Error('EPUB previews support files up to 20 MiB.')
  let total = 0
  let entries = 0
  const names = new Set<string>()
  return unzipSync(bytes, { filter: file => {
    total += Math.max(file.originalSize, file.size)
    if (++entries > 1000 || Math.max(file.originalSize, file.size) > 10 * 1024 * 1024 || total > 50 * 1024 * 1024) {
      throw new Error('This EPUB is too large to preview. Download it to read locally.')
    }
    if (file.name.startsWith('/') || file.name.includes('\\') || file.name.split('/').some(part => ['..', '__proto__', 'constructor', 'prototype'].includes(part)) || names.has(file.name)) {
      throw new Error('This EPUB contains invalid archive paths.')
    }
    names.add(file.name)
    return !file.name.endsWith('/')
  } })
}
