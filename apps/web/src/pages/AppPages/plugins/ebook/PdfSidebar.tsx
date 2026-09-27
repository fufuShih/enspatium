import { Box, Flex, Text, chakra } from '@chakra-ui/react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import PdfCanvas from './PdfCanvas'
import { destinationPage, flattenOutline, type PdfTocItem } from './pdfNavigation'

function Thumbnail({ document, page, active, visible, onNavigate }: {
  document: PDFDocumentProxy; page: number; active: boolean; visible: boolean; onNavigate: (page: number) => void
}) {
  const [size, setSize] = useState({ width: 612, height: 792 })
  return <chakra.button type="button" data-thumbnail={page} aria-label={`Go to page ${page}`} aria-current={active ? 'page' : undefined}
    display="block" mx="auto" mb="16px" p="5px" borderRadius="3px" cursor="pointer"
    border="2px solid" borderColor={active ? 'var(--accent-ink)' : 'transparent'} onClick={() => onNavigate(page)}
    _hover={{ bg: 'var(--background)' }}>
    <Box w="152px" h={`${152 * size.height / size.width}px`} bg="white" boxShadow="sm">
      {visible && <PdfCanvas document={document} page={page} width={152} zoom={1} onSize={setSize} thumbnail />}
    </Box>
    <Text fontSize="11px" mt="6px">{page}</Text>
  </chakra.button>
}

function Thumbnails({ document, page, onNavigate }: { document: PDFDocumentProxy; page: number; onNavigate: (page: number) => void }) {
  const root = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(new Set([page]))
  useEffect(() => {
    const observer = new IntersectionObserver(entries => setVisible(previous => {
      const next = new Set(previous)
      for (const entry of entries) {
        const number = Number((entry.target as HTMLElement).dataset.thumbnail)
        if (entry.isIntersecting) next.add(number)
        else next.delete(number)
      }
      return next
    }), { root: root.current, rootMargin: '200px 0px' })
    root.current!.querySelectorAll('[data-thumbnail]').forEach(element => observer.observe(element))
    return () => observer.disconnect()
  }, [document])
  useLayoutEffect(() => {
    const container = root.current!
    const selected = container.querySelector<HTMLElement>('[aria-current]')
    if (!selected) return
    const top = selected.offsetTop
    if (top < container.scrollTop) container.scrollTop = top
    else if (top + selected.offsetHeight > container.scrollTop + container.clientHeight) container.scrollTop = top + selected.offsetHeight - container.clientHeight
  }, [page])
  return <Box ref={root} h="full" overflowY="auto" position="relative" py="12px">
    {Array.from({ length: document.numPages }, (_, index) => <Thumbnail key={index + 1} document={document} page={index + 1}
      active={page === index + 1} visible={visible.has(index + 1)} onNavigate={onNavigate} />)}
  </Box>
}

export default function PdfSidebar({ document, page, onNavigate, open, navigationKey }: { document: PDFDocumentProxy; page: number; onNavigate: (page: number) => void; open: boolean; navigationKey?: number }) {
  const [tab, setTab] = useState<'thumbnails' | 'toc'>('toc')
  const [outline, setOutline] = useState<PdfTocItem[] | null>(null)
  const [outlineError, setOutlineError] = useState('')
  const [navigationError, setNavigationError] = useState('')
  const [selected, setSelected] = useState<{ index: number; page: number } | null>(null)
  const request = useRef(0)
  const id = useId()
  // A slow TOC lookup from the previous reading tab must not move the new tab.
  useLayoutEffect(() => { request.current++ }, [navigationKey])
  useEffect(() => {
    let active = true
    void document.getOutline().then(items => { if (active) setOutline(flattenOutline(items)) })
      .catch(() => { if (active) setOutlineError('The table of contents could not be loaded.') })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- This is a request counter, not a DOM ref; invalidate the latest request on unmount.
    return () => { active = false; request.current++ }
  }, [document])
  async function navigate(item: PdfTocItem, index: number) {
    const token = ++request.current
    setNavigationError('')
    try {
      const target = await destinationPage(document, item.dest)
      if (token !== request.current) return
      if (target === null) { setNavigationError('This section has no available page.'); return }
      setSelected({ index, page: target })
      onNavigate(target)
    } catch { if (token === request.current) setNavigationError('Cannot open this section. Try the thumbnails instead.') }
  }
  return <Flex direction="column" h="full">
    <Flex role="tablist" aria-label="PDF sidebar views" gap="4px" p="6px 8px" borderBottom="1px solid var(--border)" flexShrink={0}>
      {(['thumbnails', 'toc'] as const).map((value, index) => <chakra.button key={value} type="button" role="tab"
        id={`${id}-${value}`} aria-controls={`${id}-${value}-panel`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1}
        aria-label={value === 'toc' ? 'Table of contents' : 'Thumbnails'} title={value === 'toc' ? 'Table of contents' : 'Thumbnails'}
        p="6px" borderRadius="3px" cursor="pointer" color={tab === value ? 'var(--accent-ink)' : 'var(--muted)'}
        bg={tab === value ? 'var(--background)' : 'transparent'} onClick={() => setTab(value)}
        onKeyDown={event => {
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : ['ArrowLeft', 'ArrowRight'].includes(event.key) ? 1 - index : null
          if (next === null) return
          event.preventDefault()
          const buttons = event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role="tab"]')
          buttons[next]!.focus(); buttons[next]!.click()
        }}>
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          {value === 'toc' ? <path d="M3 4h2m3 0h9M3 10h2m3 0h9M3 16h2m3 0h9" /> : <><rect x="3" y="2" width="14" height="16" rx="1" /><path d="m5 14 3-4 3 2 2-3 2 5M6 6h2" /></>}
        </svg>
      </chakra.button>)}
    </Flex>
    {tab === 'thumbnails' ? <Box role="tabpanel" id={`${id}-thumbnails-panel`} aria-labelledby={`${id}-thumbnails`} flex="1" minH="0">
      {open && <Thumbnails document={document} page={page} onNavigate={onNavigate} />}
    </Box> : <Box role="tabpanel" id={`${id}-toc-panel`} aria-labelledby={`${id}-toc`} flex="1" minH="0" overflowY="auto" p="8px">
      {outlineError ? <Text role="status" fontSize="13px" p="8px">{outlineError}</Text>
        : !outline ? <Text role="status" fontSize="13px" p="8px">Loading table of contents...</Text>
        : outline.length === 0 ? <Text fontSize="13px" color="var(--muted)" p="8px">This PDF has no table of contents.</Text>
        : outline.map((item, index) => <chakra.button key={index} type="button" display="block" w="full" textAlign="left"
          py="7px" pr="8px" pl={`${8 + Math.min(item.depth, 8) * 12}px`} fontSize="13px" lineHeight="1.5" borderRadius="3px"
          overflowWrap="anywhere" cursor={item.dest == null ? 'default' : 'pointer'} disabled={item.dest == null}
          aria-current={selected?.index === index && selected.page === page ? 'location' : undefined}
          bg={selected?.index === index && selected.page === page ? 'var(--background)' : 'transparent'}
          _hover={{ bg: 'var(--background)' }} onClick={() => { void navigate(item, index) }}>{item.title}</chakra.button>)}
      {navigationError && <Text role="status" fontSize="12px" p="8px">{navigationError}</Text>}
    </Box>}
  </Flex>
}
