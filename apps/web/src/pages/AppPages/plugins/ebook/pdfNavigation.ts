import type { PDFDocumentProxy } from 'pdfjs-dist'

export function parsePageNumber(value: string, pageCount: number): number | null {
  const input = value.trim()
  if (!/^\d+$/.test(input)) return null
  const page = Number(input)
  return Number.isSafeInteger(page) && page >= 1 && page <= pageCount ? page : null
}

export type PdfOutline = { title: string; dest: string | unknown[] | null; items: PdfOutline[] }
export type PdfTocItem = { title: string; dest: PdfOutline['dest']; depth: number }

export function flattenOutline(outline: PdfOutline[] | null): PdfTocItem[] {
  const result: PdfTocItem[] = []
  const pending = (outline ?? []).map(item => ({ item, depth: 0 })).reverse()
  // Bound work for malformed files, without recursive calls on untrusted nesting.
  while (pending.length && result.length < 10_000) {
    const { item, depth } = pending.pop()!
    result.push({ title: item.title || 'Untitled section', dest: item.dest, depth })
    for (let index = (item.items?.length ?? 0) - 1; index >= 0; index--) pending.push({ item: item.items[index]!, depth: depth + 1 })
  }
  return result
}

export async function destinationPage(document: Pick<PDFDocumentProxy, 'getDestination' | 'getPageIndex' | 'numPages'>, target: PdfOutline['dest']) {
  const destination = typeof target === 'string' ? await document.getDestination(target) : target
  if (!Array.isArray(destination) || !destination.length) return null
  const ref: unknown = destination[0]
  let index: number
  if (typeof ref === 'number' && Number.isInteger(ref)) index = ref
  else if (ref && typeof ref === 'object' && 'num' in ref && 'gen' in ref
    && typeof ref.num === 'number' && Number.isInteger(ref.num) && ref.num > 0
    && typeof ref.gen === 'number' && Number.isInteger(ref.gen) && ref.gen >= 0) {
    index = await document.getPageIndex({ num: ref.num, gen: ref.gen })
  } else return null
  return Number.isInteger(index) && index >= 0 && index < document.numPages ? index + 1 : null
}
