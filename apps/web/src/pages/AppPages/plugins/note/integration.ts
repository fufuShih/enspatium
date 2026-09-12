import { getAppObject } from '../../../../api/generated/app-objects'
import { uploadObject } from '../../../../api/generated/objects'
import { createObjectAppIntegration } from '../../objectIntegration'
import type { AppSpace } from '../../types'

export const noteIntegration = createObjectAppIntegration('note')
export const noteSizeLimit = 1024 * 1024

export function noteKey(name: string) {
  const key = name.trim()
  if (!key || key.startsWith('/') || key.includes('\\') || /[\u0000-\u001f\u007f]/.test(key)
    || key.split('/').some(part => !part.trim() || part === '.' || part === '..')) {
    throw new Error('Enter a note name, optionally inside a folder, such as Journal/Today.')
  }
  const result = /\.(md|markdown)$/i.test(key) ? key : `${key}.md`
  if (result.length > 1024) throw new Error('This note name is too long.')
  return result
}

export async function loadNote(space: AppSpace, id: string, signal: AbortSignal) {
  const file = await getAppObject(space.account, space.slug, 'note', id, { signal })
  if (file.sizeBytes > noteSizeLimit) throw new Error('This note exceeds the 1 MiB editor limit. Download it from Files.')
  const response = await fetch(noteIntegration.contentUrl(space.account, space.slug, { key: file.key, versionId: file.versionId }), { signal, credentials: 'include' })
  if (!response.ok) throw Object.assign(new Error('Unable to open this note.'), { status: response.status })
  const buffer = await response.arrayBuffer()
  if (buffer.byteLength > noteSizeLimit) throw new Error('This note exceeds the 1 MiB editor limit. Download it from Files.')
  // Preserve a UTF-8 BOM and line endings; unsupported Markdown remains ordinary editable text.
  let content: string
  try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer) }
  catch { throw new Error('This note is not UTF-8 text. Convert it to UTF-8 before editing.') }
  return { file, content }
}

export async function saveNote(space: AppSpace, key: string, content: string, expectedVersion: string) {
  const body = new Blob([content], { type: 'text/markdown' })
  if (body.size > noteSizeLimit) throw new Error('Notes can contain up to 1 MiB of text.')
  // Pin to the version that was opened, never silently overwrite a newer edit.
  return uploadObject(space.account, space.slug, key, body, { expectedVersion }, { headers: { 'Content-Type': 'text/markdown' } })
}
