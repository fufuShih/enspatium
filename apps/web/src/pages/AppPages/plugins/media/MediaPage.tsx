import { Box, Flex, Heading, Text, chakra } from '@chakra-ui/react'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { ListAppObjectsParams } from '../../../../api/generated/api.schemas'
import { ActionButton, TextInput } from '../../../../components/ui/Primitives'
import RequestState from '../../../../components/RequestState'
import { useAuth } from '../../../../context/auth'
import { fileErrorMessage } from '../../../SpacesPage/objectFileApi'
import { storageErrorTitle } from '../../../SpacesPage/storageErrors'
import type { AppPageProps } from '../../types'
import { mediaIntegration } from './integration'
import MediaThumbnail, { MediaIcon } from './MediaThumbnail'
import MediaPlayer from './MediaPlayer'

const categories = [
  { kind: undefined, label: 'All media' },
  { kind: 'video', label: 'Videos' },
  { kind: 'audio', label: 'Music' },
  { kind: 'image', label: 'Photos' },
] as const

export default function MediaPage({ space: { account, slug, name } }: AppPageProps) {
  const { user } = useAuth()
  const [search, setSearch] = useSearchParams()
  const kindValue = search.get('kind')
  const kind = kindValue === 'audio' || kindValue === 'video' || kindValue === 'image' ? kindValue : undefined
  const filter = search.get('search') || ''
  const params: ListAppObjectsParams = { kind, search: filter, cursor: search.get('after') || undefined, limit: 30 }
  const media = mediaIntegration.useList(account, slug, params, { query: {
    queryKey: [...mediaIntegration.listQueryKey(account, slug, params), user?.id ?? null],
    retry: false, gcTime: 0, staleTime: 0, refetchOnMount: 'always', refetchInterval: 30_000,
  } })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const playerRegion = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const files = media.isError ? [] : media.data?.objects ?? []
  const selected = files.find(file => file.id === selectedId)
  const photos = files.filter(file => file.kind === 'image')
  const photoIndex = photos.findIndex(file => file.id === selectedId)
  const category = categories.find(item => item.kind === kind)!

  useEffect(() => {
    if (selectedId) {
      playerRegion.current?.focus({ preventScroll: true })
      playerRegion.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedId])

  function navigate(nextKind: typeof kind | null = kind, nextFilter = filter, after?: string) {
    setSelectedId(null)
    setSearch({ ...(nextKind ? { kind: nextKind } : {}), ...(nextFilter ? { search: nextFilter } : {}), ...(after ? { after } : {}) })
  }
  function closePlayer() { setSelectedId(null); trigger.current?.focus() }

  return <Box as="section" aria-label="Media library" minH="100dvh" bg="var(--background)" color="var(--foreground)" css={{ '& :is(button, a, input):focus-visible': { outline: '2px solid var(--accent-ink)', outlineOffset: '4px' } }} onKeyDown={event => { if (event.key === 'Escape' && selected) { event.preventDefault(); closePlayer() } }}>
    <Flex maxW="1560px" mx="auto" align="center" gap="24px" p={{ base: '20px', md: '22px 32px' }} borderBottom="1px solid color-mix(in srgb, var(--border) 60%, transparent)">
      <Flex align="center" gap="10px" flexShrink="0" minW={{ md: '164px' }}><Box w="12px" h="12px" bg="var(--accent)" borderRadius="full" boxShadow="0 0 0 5px color-mix(in srgb, var(--accent) 8%, transparent)" /><Text fontSize="15px" fontWeight="600" letterSpacing="-.02em">Media</Text></Flex>
      <Text fontSize="13px" color="var(--muted)" lineClamp={1} flex="1">{name}</Text>
      <ActionButton onClick={() => { setReload(value => value + 1); void media.refetch() }} fontSize="12px" borderRadius="full">Reload</ActionButton>
    </Flex>
    <Box maxW="1560px" mx="auto" display="grid" gridTemplateColumns={{ base: '1fr', md: '208px minmax(0, 1fr)' }}>
      <Box as="nav" aria-label="Media categories" p={{ base: '16px 20px', md: '32px 20px' }} borderRight={{ md: '1px solid color-mix(in srgb, var(--border) 60%, transparent)' }}>
        <Text display={{ base: 'none', md: 'block' }} color="var(--muted)" fontSize="10px" fontWeight="600" letterSpacing=".12em" mb="16px" px="12px">LIBRARY</Text>
        <Flex direction={{ base: 'row', md: 'column' }} gap="6px" overflowX="auto" pb="4px">
          {categories.map(item => <chakra.button key={item.label} type="button" aria-pressed={kind === item.kind} display="flex" alignItems="center" gap="12px" p={{ base: '10px 12px', md: '12px' }} borderRadius="8px" whiteSpace="nowrap" flexShrink="0" cursor="pointer" textAlign="left" fontSize="13px" bg={kind === item.kind ? 'var(--surface-strong)' : 'transparent'} color={kind === item.kind ? 'var(--accent-ink)' : 'var(--muted)'} _hover={{ bg: 'var(--surface)', color: 'var(--foreground)' }} onClick={() => navigate(item.kind ?? null)}><Box display={{ base: 'none', md: 'block' }}><MediaIcon kind={item.kind} /></Box>{item.label}</chakra.button>)}
        </Flex>
      </Box>
      <Box minW="0" p={{ base: '8px 20px 40px', md: '32px' }}>
        <Flex align="center" justify="space-between" gap="24px" wrap="wrap" mb="30px">
          <Box minW="0"><Heading as="h1" fontSize={{ base: '26px', md: '30px' }} fontWeight="600" letterSpacing="-.035em" overflowWrap="anywhere">{name}</Heading><Text mt="8px" color="var(--muted)" fontSize="13px">Your collection. Press play.</Text></Box>
          <MediaSearch key={filter} value={filter} onSearch={value => navigate(kind, value)} />
        </Flex>
        {selected && <Box ref={playerRegion} id="media-player" as="section" aria-label="Now playing" tabIndex={-1} mb="32px" p={{ base: '14px', md: '20px' }} border="1px solid var(--border)" borderRadius="14px" bg="var(--surface)" outline="none" maxW="960px" scrollMarginTop="20px">
          <Flex align="center" justify="space-between" mb="14px" gap="12px"><Text color="var(--accent-ink)" fontSize="11px" fontWeight="600" letterSpacing=".1em">{selected.kind === 'image' ? 'PHOTO VIEWER' : 'NOW PLAYING'}</Text><ActionButton onClick={closePlayer} aria-label="Close player" p="6px 10px" fontSize="12px">Close<Text as="span" aria-hidden="true">×</Text></ActionButton></Flex>
          <MediaPlayer key={`${selected.versionId}:${reload}`} account={account} slug={slug} file={selected} />
          {selected.kind === 'image' && <Flex gap="8px" mt="16px" justify="space-between">
            <ActionButton disabled={photoIndex <= 0} onClick={() => setSelectedId(photos[photoIndex - 1]!.id)}>Previous photo</ActionButton>
            <ActionButton disabled={photoIndex >= photos.length - 1} onClick={() => setSelectedId(photos[photoIndex + 1]!.id)}>Next photo</ActionButton>
          </Flex>}
        </Box>}
        <Flex justify="space-between" align="center" gap="12px" mb="18px"><Heading as="h2" fontSize="17px" fontWeight="500">{filter ? `Results for “${filter}”` : category.label}</Heading>{!media.isPending && !media.isError && <Text flexShrink="0" color="var(--muted)" fontSize="12px">{files.length}{media.data.nextCursor ? '+' : ''} items</Text>}</Flex>
        {media.isPending ? <RequestState loading title="Loading media..." /> : media.isError ? <RequestState title={storageErrorTitle(media.error, 'Unable to load media')} message={fileErrorMessage(media.error, 'list')} onRetry={() => { void media.refetch() }} /> : !files.length ?
          <RequestState title={filter || kind ? 'No matching media' : 'No media yet'} message={filter || kind ? 'Try another filename or category.' : 'Your music, videos and photos will appear here.'} /> : <>
            <Box as="ul" aria-label="Media items" listStyleType="none" p="0" m="0" display="grid" gridTemplateColumns={{ base: '1fr', sm: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' }} gap="24px 18px">
              {files.map(file => <Box as="li" key={file.id} minW="0"><chakra.button type="button" w="full" textAlign="left" cursor="pointer" borderRadius="12px" p="4px" border="1px solid" borderColor={selectedId === file.id ? 'var(--accent)' : 'transparent'} bg={selectedId === file.id ? 'var(--surface-strong)' : 'transparent'} _hover={{ bg: 'var(--surface)', borderColor: 'var(--muted)' }} aria-label={`Open media ${file.key}`} aria-pressed={selectedId === file.id} aria-controls={selectedId === file.id ? 'media-player' : undefined} onClick={event => { trigger.current = event.currentTarget; setSelectedId(file.id) }}>
                <MediaThumbnail key={`${file.versionId}:${reload}`} account={account} slug={slug} file={file} />
                <Box px="6px" pt="12px" pb="8px"><Text fontSize="14px" fontWeight="500" lineClamp={2} overflowWrap="anywhere">{file.key.split('/').at(-1)}</Text><Flex align="center" gap="6px" mt="5px" color="var(--muted)" fontSize="11px"><Text>{file.kind === 'audio' ? 'Music' : file.kind === 'video' ? 'Video' : 'Photo'}</Text>{selectedId === file.id && <Text color="var(--accent-ink)">· Selected</Text>}</Flex></Box>
              </chakra.button></Box>)}
            </Box>
            <Flex gap="8px" mt="28px">
              {params.cursor && <ActionButton onClick={() => navigate()}>First page</ActionButton>}
              {media.data.nextCursor && <ActionButton onClick={() => navigate(kind, filter, media.data.nextCursor!)}>Next page</ActionButton>}
            </Flex>
          </>}
      </Box>
    </Box>
  </Box>
}

function MediaSearch({ value, onSearch }: { value: string; onSearch: (value: string) => void }) {
  const [text, setText] = useState(value)
  return <Flex asChild gap="8px" w={{ base: 'full', lg: '340px' }} minW="0"><form role="search" onSubmit={event => { event.preventDefault(); onSearch(text.trim()) }}>
    <TextInput aria-label="Search media" maxLength={128} placeholder="Search your collection" _placeholder={{ color: 'var(--muted)' }} borderRadius="full" minW="0" value={text} onChange={event => setText(event.target.value)} />
    <ActionButton type="submit" borderRadius="full">Search</ActionButton>
  </form></Flex>
}
