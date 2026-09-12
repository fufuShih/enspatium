import { expect, test, vi } from 'vitest'
import { prepareUploads, readDroppedFiles, selectFiles } from '../src/pages/SpacesPage/uploadSelection'
import { uploadFile, fileSizeLimit, type UploadAttempt } from '../src/pages/SpacesPage/objectFileApi'

const signal = () => new AbortController().signal
function fileEntry(name: string): FileSystemEntry {
  return { name, isFile: true, isDirectory: false, file: (resolve: (file: File) => void) => resolve(new File([name], name)) } as unknown as FileSystemEntry
}
function directory(name: string, children: FileSystemEntry[]) {
  const read = vi.fn()
  return { read, entry: { name, isFile: false, isDirectory: true, createReader: () => {
    let offset = 0
    return { readEntries: (resolve: (entries: FileSystemEntry[]) => void) => {
      read(); const next = children.slice(offset, offset + 100); offset += next.length; resolve(next)
    } }
  } } as unknown as FileSystemEntry }
}
function dropped(entries: FileSystemEntry[]): DataTransfer {
  return { items: entries.map(entry => ({ kind: 'file', webkitGetAsEntry: () => entry })) } as unknown as DataTransfer
}

test('directory drops read every batch and keep Unicode, spaces, root folders and empty files', async () => {
  const files = Array.from({ length: 205 }, (_, i) => fileEntry(`file ${i}.txt`))
  const deep = directory('音樂 %_#', [fileEntry('歌曲.txt')])
  const empty = directory('empty', [])
  const album = directory('album', [...files, deep.entry, empty.entry])
  const input = dropped([album.entry, fileEntry('root.txt')])
  const reading = readDroppedFiles(input, signal())
  // All entry handles must be captured before the first await, while drop is readable.
  for (const item of Array.from(input.items)) item.webkitGetAsEntry = () => { throw new Error('Drag data is protected') }
  const result = await reading
  expect(album.read).toHaveBeenCalledTimes(4)
  expect(result.files).toHaveLength(207)
  expect(result.emptyFolders).toBe(1)
  expect(result.files.map(file => file.path)).toContain('album/音樂 %_#/歌曲.txt')
  const prepared = prepareUploads(result, 'uploads/')
  expect(prepared.every(item => item.status === 'queued')).toBe(true)
  expect(prepared.map(item => item.attempt.key)).toContain('uploads/album/file 204.txt')
  const emptyFile = new File([], 'zero.bin')
  expect(prepareUploads(selectFiles([emptyFile]), '')[0]).toMatchObject({ file: emptyFile, status: 'queued' })
})

test('folder selections preserve relative paths and validate the entire destination before uploading', () => {
  const file = new File(['x'], 'name.txt')
  Object.defineProperty(file, 'webkitRelativePath', { value: 'album/中文/name.txt' })
  expect(prepareUploads(selectFiles([file]), 'target/')[0]!.attempt.key).toBe('target/album/中文/name.txt')
  const invalid = ['', '/absolute.txt', '../escape.txt', 'a/../b', 'a//b', 'bad\\path', 'nul.txt', 'trailing.']
  expect(prepareUploads({ files: invalid.map(path => ({ file, path })), emptyFolders: 0 }, '').every(item => item.status === 'failed' && !item.retryable)).toBe(true)
  expect(prepareUploads(selectFiles([file]), '../')[0]!.status).toBe('failed')
  const large = new File([], 'large.bin')
  Object.defineProperty(large, 'size', { value: fileSizeLimit + 1 })
  expect(prepareUploads(selectFiles([large]), '')[0]!.message).toContain('100 MiB')
  const conflicts = prepareUploads({ files: ['same', 'same', 'folder', 'folder/file.txt', 'good.txt'].map(path => ({ file, path })), emptyFolders: 0 }, '')
  expect(conflicts.map(item => item.status)).toEqual(['failed', 'failed', 'failed', 'failed', 'queued'])
})

test('unreadable dropped items are reported while siblings remain uploadable; cancellation stops enumeration', async () => {
  const bad = { name: 'unreadable.txt', isFile: true, file: (_resolve: unknown, reject: (error: Error) => void) => reject(new Error('denied')) } as unknown as FileSystemEntry
  const result = await readDroppedFiles(dropped([bad, fileEntry('ok.txt')]), signal())
  expect(result.files.find(file => file.path === bad.name)?.error).toContain('Unable to read')
  expect(prepareUploads(result, '').filter(item => item.status === 'queued')).toHaveLength(1)
  await expect(readDroppedFiles(dropped([fileEntry('stop')]), AbortSignal.abort())).rejects.toThrow()
  await expect(readDroppedFiles({ items: [{ kind: 'file' }] } as unknown as DataTransfer, signal())).rejects.toThrow('Use Upload files or Upload folder')
})

test('a lost successful response cannot create another version when retried', async () => {
  const file = new File(['new contents'], 'notes.txt')
  const attempt: UploadAttempt = { key: 'docs/notes.txt' }
  let head = 'version-before'
  let writes = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    if (options?.method === 'GET') return Response.json({ versionId: head })
    writes++
    expect(String(url)).toContain('docs%2Fnotes.txt?expectedVersion=version-before')
    head = 'version-after'
    throw new TypeError('Response lost after commit')
  })
  await expect(uploadFile('owner', 'files', file, signal(), '', attempt)).rejects.toThrow('Response lost')
  expect(attempt.expectedVersion).toBe('version-before')
  await expect(uploadFile('owner', 'files', file, signal(), '', attempt)).rejects.toMatchObject({ info: { code: 'UPLOAD_VERSION_CHANGED' } })
  expect(writes).toBe(1)
})

test('retry uses the original version after a temporary failure; an aborted attempt never writes', async () => {
  const file = new File(['contents'], 'notes.txt')
  const attempt: UploadAttempt = { key: 'nested/notes.txt' }
  let fail = true
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
    if (options?.method === 'GET') return Response.json(null)
    if (fail) return Response.json({ code: 'STORAGE_BUSY' }, { status: 409 })
    return Response.json({ key: attempt.key }, { status: 201 })
  })
  await expect(uploadFile('owner', 'files', file, signal(), '', attempt)).rejects.toMatchObject({ status: 409 })
  fail = false
  await expect(uploadFile('owner', 'files', file, signal(), '', attempt)).resolves.toMatchObject({ key: attempt.key })
  expect(attempt.expectedVersion).toBe('none')
  fetch.mockClear()
  await expect(uploadFile('owner', 'files', file, AbortSignal.abort(), '', attempt)).rejects.toThrow()
  expect(fetch.mock.calls.every(([, options]) => options?.method === 'GET')).toBe(true)
})
