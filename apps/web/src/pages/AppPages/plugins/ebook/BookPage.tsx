import { Box, Text } from '@chakra-ui/react'
import { lazy, Suspense } from 'react'
import { useLocation, useParams } from 'react-router'
import { ActionButton, PageLink } from '../../../../components/ui/Primitives'
import RequestState from '../../../../components/RequestState'
import { useAuth } from '../../../../context/auth'
import { apiStatus } from '../../../../context/session'
import { fileErrorMessage } from '../../../SpacesPage/object/objectFileApi'
import type { AppPageProps } from '../../types'
import { ReaderHeader } from './ReaderLayout'
import { ebookIntegration } from './integration'

const EpubReader = lazy(() => import('./EpubReader'))
const PdfReader = lazy(() => import('./PdfReader'))

export default function BookPage(props: AppPageProps) {
  const { bookId = '' } = useParams()
  // A different book must discard the previous reader's chapters, page and source.
  return <BookContent key={bookId} {...props} bookId={bookId} />
}

function BookContent({ instance, basePath, bookId }: AppPageProps & { bookId: string }) {
  const { user } = useAuth()
  const location = useLocation()
  const book = ebookIntegration.useItem(instance.id, bookId, { query: {
    queryKey: [...ebookIntegration.itemQueryKey(instance.id, bookId), user?.id ?? null],
    retry: false, gcTime: 0, staleTime: 0, refetchOnMount: 'always', refetchInterval: 30_000,
  } })
  const file = book.isError ? undefined : book.data
  const source = file ? ebookIntegration.contentUrl(instance.id, { key: file.key, versionId: file.versionId }) : ''
  const status = apiStatus(book.error)
  const missing = status === 400 || status === 404
  // Retain the shelf's filters for in-app navigation; shared URLs return to the full shelf.
  const librarySearch = typeof location.state?.librarySearch === 'string' ? location.state.librarySearch : ''
  const libraryPath = basePath + (librarySearch ? `?${librarySearch}` : '')

  const readerBook = { title: file?.key.split('/').at(-1) ?? 'Book', libraryPath, source: file ? source : undefined }
  return <Box as="section" aria-label="Ebook library" h="100dvh" overflow="hidden" bg="var(--background)" color="var(--foreground)"
    css={{ '& :is(button, a, input, select):focus-visible': { outline: '2px solid var(--accent-ink)', outlineOffset: '2px' } }}>
    {(!file || book.isPending) && <ReaderHeader book={readerBook} />}
    {book.isPending ? <RequestState loading title="Loading book..." /> : book.isError ? <RequestState
      title={missing ? 'Book not found' : status === 401 ? 'Sign in to read this book' : status === 403 ? 'Access denied' : 'Unable to load book'}
      message={missing ? 'This book is no longer available in this library.' : fileErrorMessage(book.error, 'preview')}
      onRetry={missing || status === 401 ? undefined : () => { void book.refetch() }}>
      {status === 401 && <ActionButton asChild mt="20px"><PageLink to="/login" state={{ from: location.pathname + location.search }}>Sign in</PageLink></ActionButton>}
    </RequestState> : file && <Box as="section" aria-label="Book reader" h="full">
      <Suspense fallback={<><ReaderHeader book={readerBook} /><Text role="status" p="24px">Opening reader...</Text></>}>
        {file.kind === 'epub' ? <EpubReader key={file.versionId} source={source} size={file.sizeBytes} readerBook={readerBook} /> : <PdfReader key={file.versionId} source={source} readerBook={readerBook} />}
      </Suspense>
    </Box>}
  </Box>
}
