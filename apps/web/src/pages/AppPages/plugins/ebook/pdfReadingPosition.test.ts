import { expect, test } from 'vitest'
import { capturePosition, restorePosition } from './pdfReadingPosition'

test('restores the exact position inside a page, including horizontal scrolling', () => {
  const pages = [{ page: 1, top: 12, height: 800 }, { page: 2, top: 828, height: 800 }]
  const saved = capturePosition(pages, 1108, 150, 300)
  expect(saved).toEqual({ page: 2, offset: 0.35, horizontal: 0.5 })
  expect(restorePosition(saved, pages, 300)).toEqual({ top: 1108, left: 150 })
  // A tab opened at a different window width still returns to the same part of the page.
  expect(restorePosition(saved, [{ page: 1, top: 12, height: 400 }, { page: 2, top: 428, height: 400 }], 100)).toEqual({ top: 568, left: 50 })
})

test('preserves the document start and page gaps, and tolerates a loading document', () => {
  const pages = [{ page: 1, top: 12, height: 800 }, { page: 2, top: 828, height: 800 }]
  for (const top of [0, 12, 812, 820, 828]) {
    expect(restorePosition(capturePosition(pages, top, 0, 0), pages, 0)).toEqual({ top, left: 0 })
  }
  expect(restorePosition(capturePosition([], 0, 0, 0), [], 0)).toEqual({ top: 0, left: 0 })
})
