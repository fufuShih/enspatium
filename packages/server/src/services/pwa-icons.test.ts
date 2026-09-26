import sharp from 'sharp'
import { expect, test } from 'vitest'
import { builtinPwaIcon, maxPwaIconBytes, sanitizePwaIcon } from './pwa-icons.js'

test('installation icons are normalized, correctly sized PNGs without source metadata', async () => {
  const source = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#2468ab' } }).jpeg().withExif({ IFD0: { Copyright: 'Private metadata' } }).toBuffer()
  const result = await sanitizePwaIcon(source)
  for (const [bytes, size] of [[result.small, 192], [result.large, 512]] as const) {
    const metadata = await sharp(bytes).metadata()
    expect(metadata).toMatchObject({ format: 'png', width: size, height: size })
    expect(metadata.exif).toBeUndefined()
    expect(metadata.xmp).toBeUndefined()
    expect(bytes.toString()).not.toContain('Private metadata')
  }
})

test('untrusted SVG, malformed images and oversized input are rejected', async () => {
  const overPixels = await sharp({ create: { width: 2049, height: 2, channels: 3, background: 'red' } }).png().toBuffer()
  for (const input of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.from([255, 216, 255]), Buffer.alloc(maxPwaIconBytes + 1), overPixels]) {
    await expect(sanitizePwaIcon(input)).rejects.toMatchObject({ statusCode: 400 })
  }
})

test('bundled icons are separate per type and have the required raster sizes', async () => {
  const icons = await Promise.all(['note', 'ebook', 'media'].map(type => builtinPwaIcon(type, 192)))
  expect(new Set(icons.map(icon => icon.toString('base64'))).size).toBe(3)
  for (const icon of icons) expect(await sharp(icon).metadata()).toMatchObject({ width: 192, height: 192, format: 'png' })
  expect(await sharp(await builtinPwaIcon('note', 512)).metadata()).toMatchObject({ width: 512, height: 512 })
})
