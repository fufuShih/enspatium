import { Box, Flex, Heading, Text, chakra } from '@chakra-ui/react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { getDownloadMediaUrl, getListMediaQueryKey, headMediaContent, useListMedia } from '../../api/generated/objects'
import type { ListMedia200ObjectsItem, ListMediaParams } from '../../api/generated/api.schemas'
import { ActionButton, SelectInput, TextInput } from '../../components/ui/Primitives'
import RequestState from '../../components/RequestState'
import { useAuth } from '../../context/auth'
import ObjectFileIcon from './ObjectFileIcon'
import { fileErrorMessage, fileSizeLimit, formatFileSize, refreshObjectLists, uploadFile } from './objectFileApi'
import { imagePreviewLimit } from './objectPreview'
import { storageErrorTitle } from './storageErrors'

export default function MediaBrowser({ account, slug }: { account: string; slug: string }) {
  const { user } = useAuth()
  const client = useQueryClient()
  const [search, setSearch] = useSearchParams()
  const kindValue = search.get('kind')
  const kind = kindValue === 'audio' || kindValue === 'video' || kindValue === 'image' ? kindValue : undefined
  const filter = search.get('search') || ''
  const params: ListMediaParams = { kind, search: filter, cursor: search.get('after') || undefined, limit: 30 }
  const media = useListMedia(account, slug, params, { query: {
    queryKey: [...getListMediaQueryKey(account, slug, params), user?.id ?? null],
    retry: false, gcTime: 0, staleTime: 0, refetchOnMount: 'always', refetchInterval: 30_000,
  } })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [reload, setReload] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const uploadController = useRef<AbortController | null>(null)
  useEffect(() => () => uploadController.current?.abort(), [])
  const files = media.data?.objects ?? []
  const selected = files.find(file => file.id === selectedId)
  const photos = files.filter(file => file.kind === 'image')
  const photoIndex = photos.findIndex(file => file.id === selectedId)

  function navigate(nextKind = kind, nextFilter = filter, after?: string) {
    setSelectedId(null)
    setSearch({ ...(nextKind ? { kind: nextKind } : {}), ...(nextFilter ? { search: nextFilter } : {}), ...(after ? { after } : {}) })
  }

  async function upload(file: File) {
    if (uploadController.current) return
    setError(''); setNotice('')
    if (file.size > fileSizeLimit) { setError('Choose a file smaller than or equal to 100 MiB.'); return }
    const controller = new AbortController()
    uploadController.current = controller
    setUploading(true)
    try {
      await uploadFile(account, slug, file, controller.signal)
      if (controller.signal.aborted) return
      setNotice(`Uploaded ${file.name}.`)
      setSelectedId(null); setSearch({})
      await refreshObjectLists(client, account, slug)
    } catch (failure) {
      if (!controller.signal.aborted) setError(fileErrorMessage(failure, 'upload'))
    } finally {
      uploadController.current = null
      if (!controller.signal.aborted) setUploading(false)
    }
  }

  return <Box as="section" aria-label="Media library">
    <Flex justify="space-between" align="center" gap="16px" wrap="wrap" mb="20px">
      <Box><Heading as="h2" fontSize="20px">Media</Heading><Text mt="6px" fontSize="13px" color="var(--muted)">Music, videos and photos. Up to 100 MiB per file.</Text></Box>
      <Flex gap="8px">
        <ActionButton onClick={() => { setReload(value => value + 1); void media.refetch() }}>Reload</ActionButton>
        {user && media.data?.canUpload && !media.isError && <>
          <chakra.input ref={input} type="file" display="none" aria-label="Choose media to upload" accept="audio/*,video/*,image/jpeg,image/png,image/webp,image/gif,image/avif,image/bmp" onChange={event => {
            const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file)
          }} />
          <ActionButton loading={uploading} loadingText="Uploading..." onClick={() => input.current?.click()} bg="var(--foreground)" color="var(--background)">Upload</ActionButton>
        </>}
      </Flex>
    </Flex>
    <Flex gap="12px" mb="20px" wrap="wrap">
      <SelectInput aria-label="Media type" w="150px" value={kind ?? ''} onChange={event => navigate(event.target.value as typeof kind)}>
        <option value="">All</option><option value="audio">Music</option><option value="video">Videos</option><option value="image">Photos</option>
      </SelectInput>
      <MediaSearch key={filter} value={filter} onSearch={value => navigate(kind, value)} />
    </Flex>
    {notice && <Text role="status" mb="16px" fontSize="13px" color="fg.success" overflowWrap="anywhere">{notice}</Text>}
    {error && <Text role="alert" mb="16px" color="fg.error" fontSize="13px">{error}</Text>}
    {media.isPending ? <RequestState loading title="Loading media..." /> : media.isError ? <RequestState title={storageErrorTitle(media.error, 'Unable to load media')} message={fileErrorMessage(media.error, 'list')} onRetry={() => { void media.refetch() }} /> : !files.length ?
      <RequestState title={filter || kind ? 'No matching media' : 'No media yet'} message={media.data.canUpload ? 'Upload music, videos or photos to get started. Other files are available in Files.' : 'There is no media to show here yet.'} /> :
      <Box display="grid" gridTemplateColumns={{ base: '1fr', md: 'minmax(220px, 1fr) minmax(0, 2fr)' }} gap="24px" alignItems="start">
        <Box>
          <Box as="ul" listStyleType="none" p="0" m="0" border="1px solid var(--border)" borderRadius="8px" overflow="hidden">
            {files.map(file => <Box as="li" key={file.id} _notFirst={{ borderTop: '1px solid var(--border)' }}>
              <chakra.button type="button" w="full" p="14px" textAlign="left" display="flex" alignItems="center" gap="12px" cursor="pointer" bg={selectedId === file.id ? 'var(--surface)' : 'transparent'} _hover={{ bg: 'var(--surface)' }} _focusVisible={{ outline: '2px solid', outlineOffset: '-2px' }} aria-label={`Open media ${file.key}`} aria-pressed={selectedId === file.id} onClick={() => setSelectedId(file.id)}>
                <ObjectFileIcon kind={file.kind} /><Box flex="1" minW="0"><Text fontSize="13px" overflowWrap="anywhere">{file.key.split('/').at(-1)}</Text><Text fontSize="11px" color="var(--muted)" mt="4px" overflowWrap="anywhere">{file.key.includes('/') ? file.key + ' · ' : ''}{formatFileSize(file.sizeBytes)}</Text></Box>
              </chakra.button>
            </Box>)}
          </Box>
          <Flex gap="8px" mt="16px" wrap="wrap">
            {params.cursor && <ActionButton onClick={() => navigate()}>First page</ActionButton>}
            {media.data.nextCursor && <ActionButton onClick={() => navigate(kind, filter, media.data.nextCursor!)}>Next page</ActionButton>}
          </Flex>
        </Box>
        <Box minW="0" border="1px solid var(--border)" borderRadius="8px" p={{ base: '16px', md: '24px' }}>
          {selected ? <>
            <MediaPlayer key={`${selected.versionId}:${reload}`} account={account} slug={slug} file={selected} />
            {selected.kind === 'image' && <Flex gap="8px" mt="16px" justify="space-between">
              <ActionButton disabled={photoIndex <= 0} onClick={() => setSelectedId(photos[photoIndex - 1]!.id)}>Previous photo</ActionButton>
              <ActionButton disabled={photoIndex >= photos.length - 1} onClick={() => setSelectedId(photos[photoIndex + 1]!.id)}>Next photo</ActionButton>
            </Flex>}
          </> : <RequestState title="Choose something to play" message="Select music, a video or a photo from the list." />}
        </Box>
      </Box>}
  </Box>
}

function MediaSearch({ value, onSearch }: { value: string; onSearch: (value: string) => void }) {
  const [text, setText] = useState(value)
  return <Flex asChild flex="1" gap="8px" minW="200px"><form onSubmit={event => { event.preventDefault(); onSearch(text.trim()) }}>
    <TextInput aria-label="Search media" maxLength={128} placeholder="Search filenames" value={text} onChange={event => setText(event.target.value)} />
    <ActionButton type="submit">Search</ActionButton>
  </form></Flex>
}

function MediaPlayer({ account, slug, file }: { account: string; slug: string; file: ListMedia200ObjectsItem }) {
  const source = getDownloadMediaUrl(account, slug, { key: file.key, versionId: file.versionId })
  const player = useRef<HTMLMediaElement | null>(null)
  const probe = useRef<AbortController | null>(null)
  const [failure, setFailure] = useState('')
  const largePhoto = file.kind === 'image' && file.sizeBytes > imagePreviewLimit
  useEffect(() => {
    const element = player.current
    if (element) { element.src = source; element.load() }
    return () => {
      probe.current?.abort()
      if (element) { element.pause(); element.removeAttribute('src'); element.load() }
    }
  }, [source])
  async function failed() {
    const controller = new AbortController()
    probe.current?.abort(); probe.current = controller
    setFailure('Cannot play this file. This format may not be supported by your browser.')
    try { await headMediaContent(account, slug, { key: file.key, versionId: file.versionId }, { signal: controller.signal }) } catch (error) {
      if (!controller.signal.aborted) setFailure(fileErrorMessage(error, 'preview'))
    }
  }
  return <>
    <Heading as="h3" fontSize="16px" mb="20px" overflowWrap="anywhere">{file.key.split('/').at(-1)}</Heading>
    {largePhoto ? <Text fontSize="13px">Photo previews support files up to 10 MiB. Download this photo to view it.</Text> : file.kind === 'image' ?
      <chakra.img src={source} alt={file.key} w="full" maxH="60vh" objectFit="contain" onError={() => { void failed() }} /> : file.kind === 'audio' ?
      <chakra.audio ref={(node: HTMLAudioElement | null) => { player.current = node }} src={source} controls preload="metadata" w="full" aria-label={`Play ${file.key}`} onError={() => { void failed() }} /> :
      <chakra.video ref={(node: HTMLVideoElement | null) => { player.current = node }} src={source} controls playsInline preload="metadata" w="full" maxH="60vh" bg="black" aria-label={`Play ${file.key}`} onError={() => { void failed() }} />}
    {failure && <Text role="alert" mt="16px" fontSize="13px" color="fg.error">{failure} Reload the list and try again, or download the file.</Text>}
    <ActionButton asChild mt="20px"><chakra.a href={source} download={file.key.split('/').at(-1)}>Download</chakra.a></ActionButton>
  </>
}
