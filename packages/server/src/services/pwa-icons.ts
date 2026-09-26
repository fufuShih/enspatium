import sharp from 'sharp'
import { SpaceServiceError } from './space/space.js'

export const maxPwaIconBytes = 2 * 1024 * 1024
const invalidIcon = () => new SpaceServiceError('INVALID_INPUT', 400, 'Use a single-frame PNG, JPEG or WebP, at most 2 MiB and 2048 × 2048 pixels.')
let activeConversions = 0

export async function sanitizePwaIcon(input: Buffer) {
  const png = input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const jpeg = input[0] === 255 && input[1] === 216 && input[2] === 255
  const webp = input.toString('ascii', 0, 4) === 'RIFF' && input.toString('ascii', 8, 12) === 'WEBP'
  if ((!png && !jpeg && !webp) || input.length > maxPwaIconBytes) throw invalidIcon()
  if (activeConversions >= 2) throw new SpaceServiceError('INVALID_INPUT', 503, 'Icon processing is busy. Try again shortly.')
  activeConversions++
  try {
    const options = { failOn: 'warning' as const, limitInputPixels: 2048 * 2048 }
    const metadata = await sharp(input, options).metadata()
    if (!['png', 'jpeg', 'webp'].includes(metadata.format) || (metadata.pages ?? 1) !== 1 || !metadata.width || !metadata.height || metadata.width > 2048 || metadata.height > 2048) throw invalidIcon()
    const large = await sharp(input, options).timeout({ seconds: 5 }).rotate()
      .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
    const small = await sharp(large).timeout({ seconds: 5 }).resize(192, 192).png().toBuffer()
    return { small, large }
  } catch { throw invalidIcon() } finally { activeConversions-- }
}

// Code-native, trusted SVG icons, rendered once per deployed App type/size.
const builtinIcons = new Map<string, Promise<Buffer>>()
export function builtinPwaIcon(appType: string, size: 192 | 512) {
  const kind = ['note', 'ebook', 'media'].includes(appType) ? appType : 'generic'
  const key = `${kind}:${size}`
  let result = builtinIcons.get(key)
  if (!result) {
    const drawing = kind === 'media' ? '<path d="M210 158 350 256 210 354Z" fill="#141917" stroke="none"/>'
      : kind === 'ebook' ? '<path d="M136 156Q196 128 256 166Q316 128 376 156V356Q316 328 256 366Q196 328 136 356Z M256 166V366"/>'
        : '<rect x="156" y="128" width="200" height="256" rx="16"/><path d="M200 202H310M200 256H310M200 310H270"/>'
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" rx="100" fill="#a1e4bb"/><g fill="none" stroke="#141917" stroke-width="18" stroke-linecap="round" stroke-linejoin="round">${drawing}</g></svg>`
    result = sharp(Buffer.from(svg)).resize(size, size).png().toBuffer()
    builtinIcons.set(key, result)
    void result.catch(() => builtinIcons.delete(key))
  }
  return result
}
