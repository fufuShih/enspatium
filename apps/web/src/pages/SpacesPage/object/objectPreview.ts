import type { ListObjects200Item } from '../../../api/generated/api.schemas.ts'

export type ObjectFileKind = 'image' | 'text' | 'pdf' | 'archive' | 'audio' | 'video' | 'file'
export const textPreviewLimit = 1024 * 1024
export const imagePreviewLimit = 10 * 1024 * 1024

export function objectPreviewKind(file: Pick<ListObjects200Item, 'key' | 'contentType'>): 'image' | 'text' | null {
  const mime = file.contentType.split(';')[0].trim().toLowerCase()
  if (/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(mime)) return 'image'
  if (mime.startsWith('text/') || /^(application\/(json|xml|javascript|x-yaml|yaml)|image\/svg\+xml)$/.test(mime) || /\+(json|xml)$/.test(mime)) return 'text'
  if ((!mime || mime === 'application/octet-stream') && /\.(txt|md|markdown|json|csv|log|ya?ml|xml|html?|svg|css|[cm]?js|tsx?|jsx|py|sh|toml|ini)$/i.test(file.key)) return 'text'
  return null
}

export function objectFileKind(file: Pick<ListObjects200Item, 'key' | 'contentType'>): ObjectFileKind {
  const mime = file.contentType.toLowerCase()
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('application/pdf') || /\.pdf$/i.test(file.key)) return 'pdf'
  if (/\.(zip|gz|tar|7z|rar|bz2|xz)$/i.test(file.key)) return 'archive'
  return objectPreviewKind(file) === 'text' ? 'text' : 'file'
}

export function decodeObjectText(bytes: ArrayBuffer) {
  const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 2))
  const encoding = head[0] === 255 && head[1] === 254 ? 'utf-16le' : head[0] === 254 && head[1] === 255 ? 'utf-16be' : 'utf-8'
  const text = new TextDecoder(encoding, { fatal: true }).decode(bytes)
  // Reject binary control bytes while preserving tabs, newlines, and form feeds.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000e-\u001f]/.test(text)) throw new Error('Not a text file')
  return text
}
