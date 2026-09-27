export type PageBounds = { page: number; top: number; height: number }
export type ReadingPosition = { page: number; offset: number; horizontal: number }
export type ReadingTab = { id: number; page: number; zoom: number; position: ReadingPosition }

export function capturePosition(pages: PageBounds[], scrollTop: number, scrollLeft: number, horizontalRange: number): ReadingPosition {
  const anchor = pages.find(item => item.top + item.height > scrollTop) ?? pages.at(-1)
  return {
    page: anchor?.page ?? 1,
    offset: anchor ? (scrollTop - anchor.top) / anchor.height : 0,
    horizontal: horizontalRange > 0 ? scrollLeft / horizontalRange : 0,
  }
}

export function restorePosition(position: ReadingPosition, pages: PageBounds[], horizontalRange: number) {
  const anchor = pages.find(item => item.page === position.page)
  return {
    top: Math.max(0, anchor ? anchor.top + anchor.height * position.offset : 0),
    left: Math.max(0, position.horizontal * horizontalRange),
  }
}
