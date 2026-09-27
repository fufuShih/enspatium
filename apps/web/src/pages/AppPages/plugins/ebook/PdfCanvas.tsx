import { Box, Text, chakra } from '@chakra-ui/react'
import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'

export default function PdfCanvas({ document, page, width, zoom, onSize, thumbnail = false }: {
  document: PDFDocumentProxy; page: number; width: number; zoom: number; thumbnail?: boolean
  onSize: (size: { width: number; height: number }) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState(false)
  useEffect(() => {
    const element = canvas.current!
    let active = true
    let task: RenderTask | undefined
    void document.getPage(page).then(async pdfPage => {
      if (!active) return
      const original = pdfPage.getViewport({ scale: 1 })
      onSize({ width: original.width, height: original.height })
      const viewport = pdfPage.getViewport({ scale: Math.min(width / original.width, 1.5) * zoom })
      const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8_000_000 / (viewport.width * viewport.height)))
      element.width = Math.floor(viewport.width * ratio)
      element.height = Math.floor(viewport.height * ratio)
      task = pdfPage.render({ canvas: element, viewport, transform: [ratio, 0, 0, ratio, 0, 0] })
      await task.promise
      if (active) setBusy(false)
    }).catch(reason => {
      if (active && reason?.name !== 'RenderingCancelledException') { setBusy(false); setError(true) }
    })
    return () => {
      active = false
      task?.cancel()
      // Wait for rendering to stop, and don't clear a still-connected Strict Mode canvas.
      void (task?.promise ?? Promise.resolve()).catch(() => {}).then(() => {
        if (!element.isConnected) { element.width = 0; element.height = 0 }
      })
    }
  }, [document, page, width, zoom, onSize])
  return <Box aria-busy={busy} w="full" h="full">
    {error && <Text role={thumbnail ? 'status' : 'alert'} p="12px" fontSize="12px" color="black">{thumbnail ? 'Preview unavailable' : `Cannot render page ${page}. Download this book to read locally.`}</Text>}
    <chakra.canvas ref={canvas} aria-label={thumbnail ? `Thumbnail of page ${page}` : `PDF page ${page}`} role="img" display={error ? 'none' : 'block'} w="full" h="full" />
  </Box>
}
