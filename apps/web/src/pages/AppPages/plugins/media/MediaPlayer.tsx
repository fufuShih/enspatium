import { Box, Heading, Text, chakra } from '@chakra-ui/react'
import { useEffect, useRef, useState } from 'react'
import type { ListAppObjects200ObjectsItem } from '../../../../api/generated/api.schemas'
import { ActionButton } from '../../../../components/ui/Primitives'
import { fileErrorMessage } from '../../../SpacesPage/object/objectFileApi'
import { imagePreviewLimit } from '../../../SpacesPage/object/objectPreview'
import { MediaIcon } from './MediaThumbnail'
import { mediaIntegration } from './integration'

export default function MediaPlayer({ account, slug, file }: { account: string; slug: string; file: ListAppObjects200ObjectsItem }) {
  const source = mediaIntegration.contentUrl(account, slug, { key: file.key, versionId: file.versionId })
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
    try { await mediaIntegration.headContent(account, slug, { key: file.key, versionId: file.versionId }, { signal: controller.signal }) } catch (error) {
      if (!controller.signal.aborted) setFailure(fileErrorMessage(error, 'preview'))
    }
  }
  return <>
    <Box bg="var(--background)" borderRadius="10px" overflow="hidden">
      {largePhoto ? <Text p="24px" fontSize="13px">Photo previews support files up to 10 MiB. Download this photo to view it.</Text> : file.kind === 'image' ?
        <chakra.img src={source} alt={file.key} w="full" maxH="52vh" objectFit="contain" onError={() => { void failed() }} /> : file.kind === 'audio' ?
        <Box bgImage="radial-gradient(ellipse at top, var(--surface-strong), var(--background))" p={{ base: '24px', md: '40px' }}>
          <Box mx="auto" mb="28px" display="grid" placeItems="center" w="96px" h="96px" borderRadius="full" border="1px solid var(--border)" bg="var(--surface)" color="var(--accent-ink)"><MediaIcon kind="audio" /></Box>
          <chakra.audio ref={(node: HTMLAudioElement | null) => { player.current = node }} src={source} controls preload="metadata" w="full" aria-label={`Play ${file.key}`} onError={() => { void failed() }} />
        </Box> :
        <chakra.video ref={(node: HTMLVideoElement | null) => { player.current = node }} src={source} controls playsInline preload="metadata" w="full" maxH="52vh" aria-label={`Play ${file.key}`} onError={() => { void failed() }} />}
    </Box>
    <Heading as="h3" fontSize="17px" mt="18px" overflowWrap="anywhere">{file.key.split('/').at(-1)}</Heading>
    {failure && <Text role="alert" mt="12px" fontSize="13px" color="fg.error">{failure} Reload the library and try again, or download the file.</Text>}
    <ActionButton asChild mt="16px"><chakra.a href={source} download={file.key.split('/').at(-1)}>Download</chakra.a></ActionButton>
  </>
}
