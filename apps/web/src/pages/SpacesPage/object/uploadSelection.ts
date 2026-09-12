import { fileSizeLimit, type UploadAttempt } from './objectFileApi'
import { newObjectFolder } from './objectFolderApi'

let nextUploadId = 0

export type SelectedFile = { path: string; file?: File; error?: string }
export type UploadSelection = { files: SelectedFile[]; emptyFolders: number }
export type UploadItem = {
  id: string
  path: string
  file?: File
  size?: number
  attempt: UploadAttempt
  status: 'queued' | 'uploading' | 'uploaded' | 'failed' | 'stopped'
  message?: string
  retryable: boolean
}

export function selectFiles(files: File[]): UploadSelection {
  return { files: files.map(file => ({ file, path: file.webkitRelativePath || file.name })), emptyFolders: 0 }
}

/** Capture entries synchronously: drag data becomes protected after drop returns. */
export async function readDroppedFiles(data: DataTransfer, signal: AbortSignal): Promise<UploadSelection> {
  const items = Array.from(data.items).filter(item => item.kind === 'file')
  const entries = items.map(item => {
    const getEntry = (item as DataTransferItem & { getAsEntry?: () => FileSystemEntry | null }).getAsEntry ?? item.webkitGetAsEntry
    if (!getEntry) throw new Error('Folder dragging is unavailable here. Use Upload files or Upload folder.')
    const entry = getEntry.call(item)
    const file = entry ? null : item.getAsFile()
    return { entry, file }
  })
  const result: UploadSelection = { files: [], emptyFolders: 0 }
  // Do not use getAsFile() alone for directories: it discards their structure.
  if (!entries.length) throw new Error('Drop files or folders from your computer, or use the upload buttons.')
  const pending: { entry: FileSystemEntry; path: string }[] = []
  for (const { entry, file } of entries) {
    if (entry) pending.push({ entry, path: entry.name })
    else if (file) result.files.push({ file, path: file.name })
    else result.files.push({ path: 'Dropped item', error: 'Unable to read this item. Try Upload folder instead.' })
  }
  while (pending.length) {
    signal.throwIfAborted()
    const { entry, path } = pending.pop()!
    try {
      if (entry.isFile) {
        const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
        result.files.push({ file, path })
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader()
        let count = 0
        for (;;) {
          signal.throwIfAborted()
          const children = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
          if (!children.length) break // Chromium returns at most 100 per read.
          count += children.length
          for (const child of children) pending.push({ entry: child, path: path + '/' + child.name })
        }
        if (!count) result.emptyFolders++
      } else result.files.push({ path, error: 'This item is not a regular file or folder.' })
    } catch {
      signal.throwIfAborted()
      result.files.push({ path, error: 'Unable to read this item. Select it again after checking access.' })
    }
  }
  signal.throwIfAborted()
  return result
}

export function prepareUploads(selection: UploadSelection, prefix: string): UploadItem[] {
  const destinations = new Map<string, number>()
  const folders = new Set<string>()
  for (const selected of selection.files) {
    const key = prefix + selected.path
    destinations.set(key, (destinations.get(key) ?? 0) + 1)
    const parts = key.split('/')
    for (let end = 1; end < parts.length; end++) folders.add(parts.slice(0, end).join('/'))
  }
  return selection.files.map(selected => {
    const key = prefix + selected.path
    const parts = key.split('/')
    let error = selected.error
    if (!error && (key.length > 1024 || parts.some(part => !newObjectFolder('', part)))) error = 'This path is not supported. Rename the file or folder and select it again.'
    if (!error && (destinations.get(key) ?? 0) > 1) error = 'Another selected file uses this destination. Select this path only once.'
    if (!error && (folders.has(key) || parts.some((_, index) => index > 0 && destinations.has(parts.slice(0, index).join('/'))))) error = 'A selected file and folder use the same path. Rename one and select them again.'
    if (!error && !selected.file) error = 'Unable to read this file. Select it again.'
    if (!error && selected.file!.size > fileSizeLimit) error = 'Choose a file smaller than or equal to 100 MiB.'
    return { id: String(++nextUploadId), path: selected.path, file: error ? undefined : selected.file, size: selected.file?.size, attempt: { key },
      status: error ? 'failed' : 'queued', retryable: !error, ...(error ? { message: error } : {}) }
  })
}
