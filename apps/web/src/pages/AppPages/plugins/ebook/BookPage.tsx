import { Box, Flex, Heading, Text, chakra } from '@chakra-ui/react'
import { lazy, Suspense, useState } from 'react'
import { useLocation, useParams } from 'react-router'
import { ActionButton, PageLink } from '../../../../components/ui/Primitives'
import RequestState from '../../../../components/RequestState'
import { useAuth } from '../../../../context/auth'
import { apiStatus } from '../../../../context/session'
import { fileErrorMessage } from '../../../SpacesPage/object/objectFileApi'
import type { AppPageProps } from '../../types'
import EbookLayout from './EbookLayout'
import { ebookIntegration } from './integration'

const EpubReader = lazy(() => import('./EpubReader'))
const PdfReader = lazy(() => import('./PdfReader'))

export default function BookPage(props: AppPageProps) {
  const { bookId = '' } = useParams()
  // A different book must discard the previous reader's chapters, page and source.
  return <BookContent key={bookId} {...props} bookId={bookId} />
}

function BookContent({ space, basePath, bookId }: AppPageProps & { bookId: string }) {
  const { user } = useAuth()
  const location = useLocation()
  const [reload, setReload] = useState(0)
  const book = ebookIntegration.useItem(space.account, space.slug, bookId, { query: {
    queryKey: [...ebookIntegration.itemQueryKey(space.account, space.slug, bookId), user?.id ?? null],
    retry: false, gcTime: 0, staleTime: 0, refetchOnMount: 'always', refetchInterval: 30_000,
  } })
  const file = book.isError ? undefined : book.data
  const source = file ? ebookIntegration.contentUrl(space.account, space.slug, { key: file.key, versionId: file.versionId }) : ''
  const status = apiStatus(book.error)
  const missing = status === 400 || status === 404
  // Retain the shelf's filters for in-app navigation; shared URLs return to the full shelf.
  const librarySearch = typeof location.state?.librarySearch === 'string' ? location.state.librarySearch : ''
  const libraryPath = basePath + (librarySearch ? `?${librarySearch}` : '')

  return <EbookLayout space={space} basePath={basePath} onReload={() => { setReload(value => value + 1); void book.refetch() }}>
    <Box maxW="1040px" mx="auto" p={{ base: '24px 20px 40px', md: '32px 40px 48px' }}>
      <PageLink to={libraryPath} fontSize="13px" color="var(--muted)" display="inline-flex" mb="24px">← Back to library</PageLink>
      {book.isPending ? <RequestState loading title="Loading book..." /> : book.isError ? <RequestState
        title={missing ? 'Book not found' : status === 401 ? 'Sign in to read this book' : status === 403 ? 'Access denied' : 'Unable to load book'}
        message={missing ? 'This book is no longer available in this library.' : fileErrorMessage(book.error, 'preview')}
        onRetry={missing || status === 401 ? undefined : () => { void book.refetch() }}>
        {status === 401 && <ActionButton asChild mt="20px"><PageLink to="/login" state={{ from: location.pathname + location.search }}>Sign in</PageLink></ActionButton>}
      </RequestState> : file && <Box as="section" aria-label="Book reader">
        <Flex align="start" justify="space-between" gap="16px" wrap="wrap" mb="24px">
          <Box minW="0" flex="1"><Text color="var(--accent-ink)" fontSize="10px" letterSpacing=".12em" mb="8px">{file.kind.toUpperCase()}</Text>
            <Heading as="h1" fontSize={{ base: '24px', md: '30px' }} fontWeight="500" letterSpacing="-.03em" overflowWrap="anywhere">{file.key.split('/').at(-1)}</Heading>
          </Box>
          <ActionButton asChild flexShrink="0"><chakra.a href={source} download={file.key.split('/').at(-1)}>Download book</chakra.a></ActionButton>
        </Flex>
        <Box border="1px solid var(--border)" borderRadius="14px" bg="var(--surface)" p={{ base: '14px', md: '24px' }}>
          <Suspense fallback={<Text role="status" p="24px">Opening reader...</Text>}>
            {file.kind === 'epub' ? <EpubReader key={`${file.versionId}:${reload}`} source={source} size={file.sizeBytes} /> : <PdfReader key={`${file.versionId}:${reload}`} source={source} />}
          </Suspense>
        </Box>
      </Box>}
    </Box>
  </EbookLayout>
}
