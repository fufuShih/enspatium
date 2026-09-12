import { Box, Flex, Text, chakra } from '@chakra-ui/react'
import { useEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { ActionButton } from '../../../../components/ui/Primitives'

GlobalWorkerOptions.workerSrc = pdfWorker

export default function PdfReader({ source }: { source: string }) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [error, setError] = useState('')
  const [rendering, setRendering] = useState(true)
  const [width, setWidth] = useState(700)
  const container = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
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
    const element = container.current
    if (!element) return
    const observer = new ResizeObserver(entries => setWidth(Math.max(200, entries[0]!.contentRect.width - 24)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!document || !canvas.current) return
    const element = canvas.current
    let active = true
    let task: RenderTask | undefined
    setRendering(true)
    void document.getPage(page).then(async pdfPage => {
      if (!active) return
      const original = pdfPage.getViewport({ scale: 1 })
      const scale = Math.min(width / original.width, 1.5) * zoom
      const viewport = pdfPage.getViewport({ scale })
      const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8_000_000 / (viewport.width * viewport.height)))
      element.width = Math.floor(viewport.width * ratio)
      element.height = Math.floor(viewport.height * ratio)
      element.style.width = `${viewport.width}px`
      element.style.height = `${viewport.height}px`
      task = pdfPage.render({ canvas: element, viewport, transform: [ratio, 0, 0, ratio, 0, 0] })
      await task.promise
      if (active) setRendering(false)
    }).catch(reason => {
      if (active && reason?.name !== 'RenderingCancelledException') { setRendering(false); setError('Cannot render this PDF page. Download this book to read locally.') }
    })
    return () => { active = false; task?.cancel() }
  }, [document, page, zoom, width])

  return <Box>
    <Flex gap="8px" wrap="wrap" align="center" mb="16px">
      <ActionButton disabled={!document || page === 1} onClick={() => setPage(value => value - 1)}>Previous page</ActionButton>
      <Text aria-live="polite" fontSize="13px">Page {page} of {document?.numPages ?? '…'}</Text>
      <ActionButton disabled={!document || page === document.numPages} onClick={() => setPage(value => value + 1)}>Next page</ActionButton>
      <Flex gap="8px" ml={{ md: 'auto' }} align="center">
        <ActionButton aria-label="Zoom out" disabled={zoom <= 0.75} onClick={() => setZoom(value => value - 0.25)}>−</ActionButton>
        <Text fontSize="12px" minW="40px" textAlign="center">{Math.round(zoom * 100)}%</Text>
        <ActionButton aria-label="Zoom in" disabled={zoom >= 2} onClick={() => setZoom(value => value + 0.25)}>+</ActionButton>
      </Flex>
    </Flex>
    {error && <Text role="alert" mb="16px">{error}</Text>}
    <Box ref={container} overflow="auto" maxH="68vh" minH="320px" p="12px" bg="var(--background)" borderRadius="8px" border="1px solid var(--border)" aria-busy={rendering && !error}>
      {!document && !error && <Text role="status">Opening PDF...</Text>}
      <chakra.canvas ref={canvas} aria-label={`PDF page ${page}`} role="img" mx="auto" visibility={document && !error ? 'visible' : 'hidden'} />
    </Box>
    <Text fontSize="12px" color="var(--muted)" mt="12px">Page preview. Download the PDF for selectable text and full accessibility.</Text>
  </Box>
}
