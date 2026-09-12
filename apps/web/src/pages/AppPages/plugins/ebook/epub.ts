import DOMPurify from 'dompurify'

type Archive = Record<string, Uint8Array>
export type Chapter = { title: string; path: string }
export type Epub = { title: string; chapters: Chapter[]; files: Archive }

function xml(files: Archive, path: string) {
  const bytes = files[path]
  if (!bytes || bytes.length > 2 * 1024 * 1024) throw new Error('This EPUB has a missing or oversized chapter.')
  const source = new TextDecoder().decode(bytes)
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
    // Older EPUBs commonly have an external XHTML doctype, which we do not need.
    if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(source)) throw new Error('This EPUB contains unsupported XML entities.')
  }
  const document = new DOMParser().parseFromString(source.replace(/<!DOCTYPE[^>]*>/gi, ''), 'application/xml')
  if (document.getElementsByTagName('parsererror').length) throw new Error('This EPUB contains an invalid document.')
  return document
}

function elements(document: Document, name: string) { return Array.from(document.getElementsByTagNameNS('*', name)) }

export function archivePath(base: string, href: string) {
  if (/^[a-z][a-z\d+.-]*:|^[/\\]/i.test(href)) throw new Error('External EPUB resources are not supported.')
  const path = base.split('/').slice(0, -1)
  for (const part of decodeURIComponent(href.split('#')[0]!.split('?')[0]!).split('/')) {
    if (part === '..') { if (!path.length) throw new Error('Invalid EPUB path.'); path.pop() }
    else if (part && part !== '.') { if (part.includes('\\')) throw new Error('Invalid EPUB path.'); path.push(part) }
  }
  return path.join('/')
}

export function parseEpub(files: Archive): Epub {
  if (files['META-INF/encryption.xml']) throw new Error('Encrypted EPUBs are not supported. Use an unencrypted copy.')
  const container = xml(files, 'META-INF/container.xml')
  const root = elements(container, 'rootfile')[0]?.getAttribute('full-path')
  if (!root) throw new Error('This file is not a valid EPUB.')
  const opfPath = archivePath('', root)
  const opf = xml(files, opfPath)
  const manifest = new Map(elements(opf, 'item').map(item => [item.getAttribute('id'), item]))
  const chapters = elements(opf, 'itemref').filter(item => item.getAttribute('linear') !== 'no').map((item, index) => {
    const entry = manifest.get(item.getAttribute('idref'))
    const href = entry?.getAttribute('href')
    if (!href || entry?.getAttribute('media-type') !== 'application/xhtml+xml') throw new Error('This EPUB contains an unsupported chapter format.')
    const path = archivePath(opfPath, href)
    const document = xml(files, path)
    const title = elements(document, 'h1')[0]?.textContent || elements(document, 'h2')[0]?.textContent || elements(document, 'title')[0]?.textContent
    return { path, title: title?.trim() || `Chapter ${index + 1}` }
  })
  if (!chapters.length) throw new Error('This EPUB has no readable chapters.')
  return { title: elements(opf, 'title')[0]?.textContent?.trim() || 'Untitled book', chapters, files }
}

export function chapterHtml(book: Epub, chapter: Chapter) {
  const document = xml(book.files, chapter.path)
  // Strip all author CSS and active content. Only archive raster images are embedded.
  const fragment = DOMPurify.sanitize(elements(document, 'body')[0]?.innerHTML || '', {
    ALLOWED_TAGS: ['p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'hr', 'em', 'strong', 'b', 'i', 'u', 's', 'small', 'sub', 'sup', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'figure', 'figcaption', 'img', 'a'],
    ALLOWED_ATTR: ['src', 'alt', 'colspan', 'rowspan', 'lang', 'dir'],
    ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false, RETURN_DOM_FRAGMENT: true,
  })
  for (const img of fragment.querySelectorAll('img')) {
    const src = img.getAttribute('src') || ''
    img.removeAttribute('src')
    try {
      const path = archivePath(chapter.path, src)
      const mime = /\.png$/i.test(path) ? 'image/png' : /\.jpe?g$/i.test(path) ? 'image/jpeg' : /\.gif$/i.test(path) ? 'image/gif' : /\.webp$/i.test(path) ? 'image/webp' : undefined
      const bytes = book.files[path]
      if (mime && bytes && bytes.length <= 2 * 1024 * 1024) {
        let binary = ''
        for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
        img.setAttribute('src', `data:${mime};base64,${btoa(binary)}`)
      }
    } catch { /* Keep alt text for unavailable or external images. */ }
  }
  const wrapper = window.document.createElement('div')
  wrapper.append(fragment)
  return wrapper.innerHTML
}
