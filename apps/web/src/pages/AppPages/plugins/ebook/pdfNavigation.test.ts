import { expect, test, vi } from 'vitest'
import { destinationPage, flattenOutline, parsePageNumber } from './pdfNavigation'

test('page input accepts only whole page numbers within the document', () => {
  for (const input of ['1', ' 1 ', '001']) expect(parsePageNumber(input, 20)).toBe(1)
  expect(parsePageNumber('20', 20)).toBe(20)
  for (const input of ['', ' ', '0', '-1', '21', '2.5', '2e1', 'abc', 'Infinity', '999999999999999999']) {
    expect(parsePageNumber(input, 20)).toBeNull()
  }
  expect(parsePageNumber('1', 0)).toBeNull()
})

test('preserves PDF outline titles and nesting instead of inventing page entries', () => {
  expect(flattenOutline(null)).toEqual([])
  expect(flattenOutline([{ title: 'Part one', dest: [0], items: [
    { title: 'A chapter', dest: 'chapter', items: [] },
  ] }, { title: 'Part two', dest: null, items: [] }])).toEqual([
    { title: 'Part one', dest: [0], depth: 0 },
    { title: 'A chapter', dest: 'chapter', depth: 1 },
    { title: 'Part two', dest: null, depth: 0 },
  ])
})

test('resolves named, referenced and zero-based PDF destinations to valid pages', async () => {
  const document = { numPages: 3, getDestination: vi.fn(async () => [{ num: 10, gen: 0 }]), getPageIndex: vi.fn(async () => 2) }
  expect(await destinationPage(document, 'chapter')).toBe(3)
  expect(document.getDestination).toHaveBeenCalledWith('chapter')
  expect(document.getPageIndex).toHaveBeenCalledWith({ num: 10, gen: 0 })
  expect(await destinationPage(document, [0, { name: 'Fit' }])).toBe(1)
  for (const target of [null, [], [-1], [3], [0.5], ['javascript:alert(1)'], [{ num: -1, gen: 0 }]]) {
    expect(await destinationPage(document, target)).toBeNull()
  }
  expect(await destinationPage({ ...document, getDestination: async () => null }, 'missing')).toBeNull()
})
