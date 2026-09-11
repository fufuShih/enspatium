import { Box, chakra } from '@chakra-ui/react'
import { useEffect, useRef, useState } from 'react'
import type { ListMedia200ObjectsItem } from '../../../../api/generated/api.schemas'
import { imagePreviewLimit } from '../../../SpacesPage/objectPreview'
import { mediaIntegration } from './integration'

export function MediaIcon({ kind }: { kind?: string }) {
  return <chakra.svg w="22px" h="22px" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'video' ? <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m10 9 5 3-5 3Z" /></> : kind === 'audio' ? <><path d="M9 17V5l11-2v12M9 9l11-2" /><ellipse cx="6" cy="17" rx="3" ry="3" /><ellipse cx="17" cy="15" rx="3" ry="3" /></> : kind === 'image' ? <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 6-6 4 4 3-3 5 5" /></> : <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>}
  </chakra.svg>
}

export default function MediaThumbnail({ account, slug, file }: { account: string; slug: string; file: ListMedia200ObjectsItem }) {
  const [failed, setFailed] = useState(false)
  const source = mediaIntegration.contentUrl(account, slug, { key: file.key, versionId: file.versionId })
  return <Box position="relative" aspectRatio="16 / 10" overflow="hidden" borderRadius="10px" bg="var(--surface-strong)">
    <Box position="absolute" inset="0" display="grid" placeItems="center" color={file.kind === 'audio' ? 'var(--accent-ink)' : 'var(--muted)'} bgImage="radial-gradient(circle at 25% 20%, color-mix(in srgb, var(--accent) 18%, transparent), transparent 75%)">
      <Box display="grid" placeItems="center" w="56px" h="56px" borderRadius="full" bg="var(--surface)" border="1px solid var(--border)"><MediaIcon kind={file.kind} /></Box>
    </Box>
    {!failed && file.kind === 'image' && file.sizeBytes <= imagePreviewLimit && <chakra.img src={source} alt="" loading="lazy" decoding="async" position="absolute" inset="0" w="full" h="full" objectFit="cover" onError={() => setFailed(true)} />}
    {!failed && file.kind === 'video' && <VideoThumbnail source={source} onError={() => setFailed(true)} />}
    <Box position="absolute" right="10px" bottom="10px" display="grid" placeItems="center" w="28px" h="28px" borderRadius="full" bg="color-mix(in srgb, var(--background) 80%, transparent)" color="var(--foreground)" aria-hidden="true">{file.kind === 'image' ? '↗' : '▶'}</Box>
  </Box>
}

function VideoThumbnail({ source, onError }: { source: string; onError: () => void }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const video = ref.current
    if (!video) return
    // Read a preview only when its card approaches the viewport; never play the thumbnail.
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      video.src = source + '#t=0.1'
      video.load()
      observer.disconnect()
    }, { rootMargin: '100px' })
    observer.observe(video)
    return () => { observer.disconnect(); video.pause(); video.removeAttribute('src'); video.load() }
  }, [source])
  return <chakra.video ref={ref} muted playsInline preload="metadata" tabIndex={-1} aria-hidden="true" position="absolute" inset="0" w="full" h="full" objectFit="cover" pointerEvents="none" opacity={ready ? 1 : 0} onLoadedData={() => setReady(true)} onError={onError} />
}
