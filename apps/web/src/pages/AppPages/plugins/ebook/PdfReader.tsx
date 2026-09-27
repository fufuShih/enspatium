import { Box, Flex, Text } from '@chakra-ui/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { ActionButton } from '../../../../components/ui/Primitives'
import ReaderLayout, { type ReaderBook } from './ReaderLayout'
import PdfCanvas from './PdfCanvas'
import PdfSidebar from './PdfSidebar'
import PdfReadingTabs from './PdfReadingTabs'
import PdfPageInput from './PdfPageInput'
import { capturePosition, restorePosition, type ReadingPosition, type ReadingTab } from './pdfReadingPosition'

GlobalWorkerOptions.workerSrc = pdfWorker

function PdfPage({ document, page, width, zoom, visible }: {
  document: PDFDocumentProxy; page: number; width: number; zoom: number; visible: boolean
}) {
  const [size, setSize] = useState({ width: 612, height: 792 })
  const scale = Math.min(width / size.width, 1.5) * zoom
  return <Box data-pdf-page={page} role="group" aria-label={`Page ${page}`}
    w={`${size.width * scale}px`} h={`${size.height * scale}px`} flexShrink={0} mx="auto"
    bg="white" color="black" boxShadow="sm">
    {visible
      ? <PdfCanvas key={`${width}:${zoom}`} document={document} page={page} width={width} zoom={zoom} onSize={setSize} />
      : <Text p="16px" color="gray.500">Page {page}</Text>}
  </Box>
}

export default function PdfReader({ source, readerBook }: { source: string; readerBook: ReaderBook }) {
  return <ContinuousPdfReader key={source} source={source} readerBook={readerBook} />
}

function ContinuousPdfReader({ source, readerBook }: { source: string; readerBook: ReaderBook }) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [error, setError] = useState('')
  const [width, setWidth] = useState(700)
  const [visible, setVisible] = useState<Set<number>>(new Set([1]))
  const [tabs, setTabs] = useState<ReadingTab[]>([{ id: 1, page: 1, zoom: 1, position: { page: 1, offset: 0, horizontal: 0 } }])
  const [activeTab, setActiveTab] = useState(1)
  const container = useRef<HTMLDivElement>(null)
  const currentPage = useRef(1)
  const activeId = useRef(1)
  const nextId = useRef(2)
  const measuredWidth = useRef(700)
  const pendingPosition = useRef<ReadingPosition | null>(null)
  const pageBounds = () => {
    const root = container.current!
    const top = root.getBoundingClientRect().top
    return Array.from(root.querySelectorAll<HTMLElement>('[data-pdf-page]'), element => {
      const bounds = element.getBoundingClientRect()
      return { page: Number(element.dataset.pdfPage), top: bounds.top - top + root.scrollTop, height: bounds.height }
    })
  }
  const readPosition = () => {
    const root = container.current!
    return capturePosition(pageBounds(), root.scrollTop, root.scrollLeft, root.scrollWidth - root.clientWidth)
  }
  const visiblePage = () => {
    const root = container.current!
    const bounds = root.getBoundingClientRect()
    const selected = root.querySelector<HTMLElement>(`[data-pdf-page="${currentPage.current}"]`)?.getBoundingClientRect()
    // When zoomed out, keep an explicitly selected page while it is fully visible.
    if (selected && selected.top >= bounds.top + 11 && selected.bottom <= bounds.bottom - 11) return currentPage.current
    const center = bounds.top + root.clientHeight / 2
    for (const element of root.querySelectorAll<HTMLElement>('[data-pdf-page]')) {
      if (element.getBoundingClientRect().bottom >= center) return Number(element.dataset.pdfPage)
    }
    return currentPage.current
  }
  const refreshPage = () => {
    if (!container.current || pendingPosition.current) return
    const number = visiblePage()
    currentPage.current = number
    setPage(number)
    setTabs(previous => previous.some(tab => tab.id === activeId.current && tab.page !== number)
      ? previous.map(tab => tab.id === activeId.current ? { ...tab, page: number } : tab) : previous)
  }
  const snapshot = (): ReadingTab => ({ id: activeTab, page: visiblePage(), zoom, position: readPosition() })
  const activate = (tab: ReadingTab) => {
    pendingPosition.current = tab.position
    activeId.current = tab.id
    currentPage.current = tab.page
    setActiveTab(tab.id)
    setPage(tab.page)
    setZoom(tab.zoom)
    setVisible(new Set([Math.max(1, tab.page - 1), tab.page, tab.page + 1]))
  }
  const selectTab = (id: number) => {
    if (id === activeTab || !document) return
    const target = tabs.find(tab => tab.id === id)
    if (!target) return
    const saved = snapshot()
    setTabs(previous => previous.map(tab => tab.id === saved.id ? saved : tab))
    activate(target)
  }
  const addTab = () => {
    if (!document) return
    const saved = snapshot()
    const added = { ...saved, id: nextId.current++, position: { ...saved.position } }
    setTabs(previous => [...previous.map(tab => tab.id === saved.id ? saved : tab), added])
    activate(added)
  }
  const closeTab = (id: number) => {
    if (tabs.length === 1) return
    const remaining = tabs.filter(tab => tab.id !== id)
    if (id === activeTab) activate(remaining[Math.min(tabs.findIndex(tab => tab.id === id), remaining.length - 1)]!)
    setTabs(remaining)
  }
  const changeZoom = (value: number) => {
    if (value === zoom) return
    pendingPosition.current = readPosition()
    setZoom(value)
  }
  const jumpTo = (number: number) => {
    const root = container.current
    const target = root?.querySelector<HTMLElement>(`[data-pdf-page="${number}"]`)
    if (root && target) {
      currentPage.current = number
      root.scrollTop += target.getBoundingClientRect().top - root.getBoundingClientRect().top - 12
      refreshPage()
    }
  }
  useEffect(() => {
    const assets = `${import.meta.env.BASE_URL}pdfjs/`
    const loading = getDocument({ url: source, withCredentials: true, useSystemFonts: true,
      cMapUrl: `${assets}cmaps/`, standardFontDataUrl: `${assets}standard_fonts/`,
      wasmUrl: `${assets}wasm/`, iccUrl: `${assets}iccs/`,
    })
    let active = true
    void loading.promise.then(value => { if (active) setDocument(value) }).catch(reason => {
      if (active) setError(reason?.name === 'PasswordException' ? 'Password-protected PDFs are not supported. Download this book to read locally.' : 'Cannot open this PDF. The file may be damaged or no longer available. Reload the library to try again.')
    })
    return () => { active = false; void loading.destroy() }
  }, [source])
  useEffect(() => {
    const element = container.current!
    const observer = new ResizeObserver(() => {
      // A queued resize can arrive after React has detached the reader.
      if (container.current !== element || !element.isConnected) return
      const next = Math.max(100, element.clientWidth - 24)
      if (next === measuredWidth.current) { refreshPage(); return }
      measuredWidth.current = next
      if (!pendingPosition.current && element.querySelector('[data-pdf-page]')) pendingPosition.current = readPosition()
      setWidth(next)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!document) return
    const root = container.current!
    const observer = new IntersectionObserver(entries => {
      setVisible(previous => {
        const next = new Set(previous)
        for (const entry of entries) {
          const number = Number((entry.target as HTMLElement).dataset.pdfPage)
          if (entry.isIntersecting) next.add(number)
          else next.delete(number)
        }
        return next
      })
    }, { root, rootMargin: '600px 0px' })
    root.querySelectorAll('[data-pdf-page]').forEach(element => observer.observe(element))
    return () => observer.disconnect()
  }, [document])
  useLayoutEffect(() => {
    if (!document) return
    if (pendingPosition.current) {
      const root = container.current!
      const position = restorePosition(pendingPosition.current, pageBounds(), root.scrollWidth - root.clientWidth)
      root.scrollTop = position.top
      root.scrollLeft = position.left
      pendingPosition.current = null
    }
    refreshPage()
  }, [document, width, zoom, activeTab])

  return <ReaderLayout book={readerBook} navigationLabel="PDF navigation" active={page} onNavigate={jumpTo}
    floatingAction={<PdfReadingTabs tabs={tabs} active={activeTab} pageCount={document?.numPages ?? 0} disabled={!document} onAdd={addTab} onSelect={selectTab} onClose={closeTab} />}
    renderSidebar={(navigate, open) => document ? <PdfSidebar document={document} page={page} onNavigate={navigate} open={open} navigationKey={activeTab} /> : <Text p="16px" fontSize="13px">{error ? 'Navigation unavailable.' : 'Opening PDF...'}</Text>}
    controls={<>
      <PdfPageInput key={activeTab} page={page} pageCount={document?.numPages ?? 0} onNavigate={jumpTo} />
      <ActionButton aria-label="Zoom out" p="6px" minW="30px" border="0" disabled={!document || zoom <= 0.5} onClick={() => changeZoom(zoom - 0.25)}>−</ActionButton>
      <ActionButton aria-label="Zoom in" p="6px" minW="30px" border="0" disabled={!document || zoom >= 2} onClick={() => changeZoom(zoom + 0.25)}>+</ActionButton>
      <ActionButton aria-label="Auto zoom" title="Fit to reading area" p="6px 10px" minW="60px" disabled={!document} onClick={() => changeZoom(1)}>{zoom === 1 ? 'Auto' : `${Math.round(zoom * 100)}%`}</ActionButton>
    </>}>
    <Box ref={container} role="region" aria-label="PDF pages" tabIndex={0} overflow="auto" h="full" p="12px"
      bg="#282828" aria-busy={!document && !error}
      onScroll={refreshPage}>
      {error && <Text role="alert" color="white" p="12px">{error}</Text>}
      {!document && !error && <Text role="status" color="white">Opening PDF...</Text>}
      <Flex direction="column" gap="16px" minW="full" w="max-content">
        {document && Array.from({ length: document.numPages }, (_, index) => <PdfPage key={index + 1}
          document={document} page={index + 1} width={width} zoom={zoom} visible={visible.has(index + 1)} />)}
      </Flex>
    </Box>
  </ReaderLayout>
}
