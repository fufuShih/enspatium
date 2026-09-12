import { Box, Flex, Heading, Text, chakra } from '@chakra-ui/react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import type { ListAppObjectsParams } from '../../../../api/generated/api.schemas'
import { ActionButton, PageLink, TextInput } from '../../../../components/ui/Primitives'
import RequestState from '../../../../components/RequestState'
import { useAuth } from '../../../../context/auth'
import { fileErrorMessage, formatFileSize } from '../../../SpacesPage/object/objectFileApi'
import type { AppPageProps } from '../../types'
import { ebookIntegration } from './integration'
import { appPath } from '../../paths'
import EbookLayout, { BookIcon } from './EbookLayout'

const formats = [{ value: undefined, label: 'All books' }, { value: 'epub', label: 'EPUB' }, { value: 'pdf', label: 'PDF' }] as const

export default function EbookPage({ space, basePath }: AppPageProps) {
  const { account, slug, name } = space
  const { user } = useAuth()
  const [search, setSearch] = useSearchParams()
  const formatValue = search.get('format')
  const format = formatValue === 'epub' || formatValue === 'pdf' ? formatValue : undefined
  const filter = search.get('search') || ''
  const params: ListAppObjectsParams = { kind: format, search: filter, cursor: search.get('after') || undefined, limit: 30 }
  const library = ebookIntegration.useList(account, slug, params, { query: {
    queryKey: [...ebookIntegration.listQueryKey(account, slug, params), user?.id ?? null],
    retry: false, gcTime: 0, staleTime: 0, refetchOnMount: 'always', refetchInterval: 30_000,
  } })
  const books = library.isError ? [] : library.data?.objects ?? []
  function navigate(nextFormat: typeof format, nextFilter = filter, after?: string) {
    setSearch({ ...(nextFormat ? { format: nextFormat } : {}), ...(nextFilter ? { search: nextFilter } : {}), ...(after ? { after } : {}) })
  }

  return <EbookLayout space={space} basePath={basePath} onReload={() => { void library.refetch() }}>
    <Box maxW="1480px" mx="auto" display="grid" gridTemplateColumns={{ base: '1fr', md: '208px minmax(0, 1fr)' }}>
      <Box as="nav" aria-label="Book formats" p={{ base: '16px 20px', md: '32px 20px' }} borderRight={{ md: '1px solid var(--border)' }}>
        <Text display={{ base: 'none', md: 'block' }} fontSize="10px" letterSpacing=".14em" color="var(--muted)" px="12px" mb="16px">YOUR LIBRARY</Text>
        <Flex direction={{ base: 'row', md: 'column' }} gap="6px">
          {formats.map(item => <chakra.button key={item.label} type="button" aria-pressed={format === item.value} onClick={() => navigate(item.value)} cursor="pointer" textAlign="left" p="12px" borderRadius="8px" fontSize="13px" color={format === item.value ? 'var(--accent-ink)' : 'var(--muted)'} bg={format === item.value ? 'var(--surface-strong)' : 'transparent'} _hover={{ bg: 'var(--surface)' }}>{item.label}</chakra.button>)}
        </Flex>
        <Text display={{ base: 'none', md: 'block' }} px="12px" mt="40px" fontSize="12px" lineHeight="1.8" color="var(--muted)">A quiet place for<br />your next chapter.</Text>
      </Box>
      <Box minW="0" p={{ base: '12px 20px 40px', md: '36px' }}>
        <Flex gap="24px" wrap="wrap" align="center" justify="space-between" mb="32px">
          <Box minW="0"><Heading as="h1" fontSize={{ base: '26px', md: '32px' }} fontWeight="500" letterSpacing="-.04em" overflowWrap="anywhere">{name}</Heading><Text color="var(--muted)" fontSize="13px" mt="8px">Find a book. Settle in.</Text></Box>
          <BookSearch key={filter} value={filter} onSearch={value => navigate(format, value)} />
        </Flex>
        <Flex align="center" justify="space-between" mb="22px" gap="12px"><Heading as="h2" fontSize="16px" fontWeight="500">{filter ? `Results for “${filter}”` : formats.find(item => item.value === format)!.label}</Heading>{library.data && !library.isError && <Text fontSize="12px" color="var(--muted)">{books.length}{library.data.nextCursor ? '+' : ''} {books.length === 1 ? 'book' : 'books'}</Text>}</Flex>
        {library.isPending ? <RequestState loading title="Loading books..." /> : library.isError ? <RequestState title="Unable to load books" message={fileErrorMessage(library.error, 'list')} onRetry={() => { void library.refetch() }} /> : !books.length ?
          <RequestState title={filter || format ? 'No matching books' : 'Your bookshelf is ready'} message={filter || format ? 'Try another filename or format.' : 'Upload EPUB or PDF files in your Space, then reload to start reading.'} /> : <>
            <Box as="ul" aria-label="Books" listStyleType="none" p="0" m="0" display="grid" gridTemplateColumns={{ base: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' }} gap={{ base: '24px 16px', md: '32px 24px' }}>
              {books.map(book => {
                const title = book.key.split('/').at(-1)!.replace(/\.(epub|pdf)$/i, '').replace(/[_-]/g, ' ')
                return <Box as="li" key={book.id} minW="0"><PageLink to={appPath('ebook', space.id, 'book', book.id)} state={{ librarySearch: search.toString() }} aria-label={`Read ${book.key}`} display="block" w="full" textAlign="left" cursor="pointer" borderRadius="8px" p="5px" _hover={{ bg: 'var(--surface-strong)', transform: 'translateY(-3px)' }} transition="transform 150ms, background 150ms">
                  <Flex direction="column" justify="space-between" aspectRatio="3/4" p={{ base: '16px', md: '22px' }} borderRadius="3px 9px 9px 3px" border="1px solid var(--border)" borderLeft="5px solid var(--border)" bg={book.kind === 'epub' ? 'var(--surface)' : 'var(--surface-strong)'} bgImage="linear-gradient(105deg, transparent 70%, color-mix(in srgb, var(--accent) 8%, transparent))" boxShadow="3px 5px 12px rgb(0 0 0 / 8%)">
                    <Flex justify="space-between" align="center" color="var(--muted)"><BookIcon /><Text fontSize="9px" letterSpacing=".12em">{book.kind.toUpperCase()}</Text></Flex>
                    <Text fontFamily="Georgia, serif" fontSize={{ base: '20px', md: '25px' }} lineHeight="1.3" lineClamp={4} overflowWrap="anywhere">{title}</Text>
                    <Box w="28px" h="2px" bg="var(--accent-ink)" />
                  </Flex>
                  <Text fontSize="13px" fontWeight="500" mt="14px" lineClamp={2} overflowWrap="anywhere">{title}</Text>
                  <Text fontSize="11px" color="var(--muted)" mt="5px">{book.kind.toUpperCase()} · {formatFileSize(book.sizeBytes)}</Text>
                </PageLink></Box>
              })}
            </Box>
            <Flex gap="8px" mt="32px">
              {params.cursor && <ActionButton onClick={() => navigate(format)}>First page</ActionButton>}
              {library.data.nextCursor && <ActionButton onClick={() => navigate(format, filter, library.data.nextCursor!)}>Next page</ActionButton>}
            </Flex>
          </>}
      </Box>
    </Box>
  </EbookLayout>
}

function BookSearch({ value, onSearch }: { value: string; onSearch: (value: string) => void }) {
  const [text, setText] = useState(value)
  return <Flex asChild gap="8px" w={{ base: 'full', lg: '320px' }}><form role="search" onSubmit={event => { event.preventDefault(); onSearch(text.trim()) }}>
    <TextInput aria-label="Search books" placeholder="Search by filename" maxLength={128} borderRadius="full" minW="0" value={text} onChange={event => setText(event.target.value)} />
    <ActionButton type="submit" borderRadius="full">Search</ActionButton>
  </form></Flex>
}
