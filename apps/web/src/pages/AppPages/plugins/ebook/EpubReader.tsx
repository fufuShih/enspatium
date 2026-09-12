import { Box, Flex, Text, chakra } from '@chakra-ui/react'
import { useEffect, useMemo, useState } from 'react'
import { useTheme } from 'next-themes'
import { ActionButton, SelectInput } from '../../../../components/ui/Primitives'
import { maxEpubBytes } from './archive'
import { chapterHtml, parseEpub, type Epub } from './epub'
import EpubWorker from './epub.worker?worker'
import themeCss from '../../../../styles/theme.css?raw'

export default function EpubReader({ source, size }: { source: string; size: number }) {
  const [book, setBook] = useState<Epub | null>(null)
  const [error, setError] = useState('')
  const [chapter, setChapter] = useState(0)
  const [fontSize, setFontSize] = useState(18)
  const { resolvedTheme } = useTheme()
  useEffect(() => {
    const controller = new AbortController()
    const worker = new EpubWorker()
    let timer: ReturnType<typeof setTimeout> | undefined
    async function load() {
      if (size > maxEpubBytes) throw new Error('EPUB previews support files up to 20 MiB. Download this book to read locally.')
      const response = await fetch(source, { credentials: 'include', signal: controller.signal })
      if (!response.ok) throw new Error('This book is no longer available or you do not have access. Reload the library to try again.')
      const bytes = await response.arrayBuffer()
      if (controller.signal.aborted) return
      const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
        timer = setTimeout(() => { worker.terminate(); reject(new Error('This EPUB took too long to open. Download it to read locally.')) }, 15_000)
        worker.onmessage = event => {
          clearTimeout(timer); worker.terminate()
          if (event.data.error) reject(new Error(event.data.error))
          else resolve(event.data.files)
        }
        worker.onerror = () => { clearTimeout(timer); worker.terminate(); reject(new Error('Cannot open this EPUB. The file may be damaged.')) }
        worker.postMessage(bytes, [bytes])
      })
      if (!controller.signal.aborted) setBook(parseEpub(files))
    }
    void load().catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Cannot open this EPUB.') })
    return () => { controller.abort(); clearTimeout(timer); worker.terminate() }
  }, [source, size])
  const content = useMemo(() => {
    if (!book) return ''
    return chapterHtml(book, book.chapters[chapter]!)
  }, [book, chapter])
  const dark = resolvedTheme === 'dark'
  // Sandboxed opaque origin + CSP also protect against future sanitizer mistakes.
  const srcDoc = `<!doctype html><html class="${dark ? 'dark' : 'light'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>${themeCss}body{margin:0;padding:32px 24px;font:${fontSize}px/1.85 Georgia,serif;background:var(--background);color:var(--foreground);overflow-wrap:anywhere}body>div{max-width:680px;margin:auto}h1,h2,h3{line-height:1.35}img{max-width:100%;height:auto}pre{white-space:pre-wrap}table{max-width:100%;border-collapse:collapse}td,th{border:1px solid var(--border);padding:6px}a{color:inherit}</style></head><body><div>${content}</div></body></html>`
  if (error) return <Text role="alert" p="24px">{error}</Text>
  if (!book) return <Text role="status" p="24px">Opening EPUB...</Text>
  return <Box>
    <Flex gap="8px" wrap="wrap" align="center" pb="16px">
      <SelectInput aria-label="Chapter" flex="1" minW="160px" maxW="420px" value={chapter} onChange={event => setChapter(Number(event.target.value))}>
        {book.chapters.map((item, index) => <option key={item.path + index} value={index}>{index + 1}. {item.title}</option>)}
      </SelectInput>
      <ActionButton aria-label="Decrease text size" disabled={fontSize <= 14} onClick={() => setFontSize(value => value - 2)}>A−</ActionButton>
      <ActionButton aria-label="Increase text size" disabled={fontSize >= 28} onClick={() => setFontSize(value => value + 2)}>A+</ActionButton>
    </Flex>
    <chakra.iframe key={chapter} title="EPUB chapter" sandbox="" srcDoc={srcDoc} w="full" h="62vh" minH="320px" border="1px solid var(--border)" borderRadius="8px" />
    <Flex mt="16px" gap="12px" wrap="wrap" align="center" justify="space-between">
      <ActionButton disabled={chapter === 0} onClick={() => setChapter(value => value - 1)}>Previous chapter</ActionButton>
      <Text fontSize="12px" color="var(--muted)" aria-live="polite">{chapter + 1} / {book.chapters.length}</Text>
      <ActionButton disabled={chapter === book.chapters.length - 1} onClick={() => setChapter(value => value + 1)}>Next chapter</ActionButton>
    </Flex>
  </Box>
}
