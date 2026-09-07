import { chakra } from '@chakra-ui/react'
import type { ObjectFileKind } from './objectPreview'

export default function ObjectFileIcon({ kind }: { kind: ObjectFileKind | 'download' }) {
  return <chakra.svg width="20px" height="20px" flexShrink="0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {kind === 'download' ? <path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4" /> : <>
      <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Zm0 0v5h5" />
      {kind === 'image' ? <><circle cx="9" cy="12" r="1" /><path d="m7 18 4-4 2 2 2-2 2 4" /></> : kind === 'text' ? <path d="M8 12h7M8 15h8M8 18h5" /> : kind === 'archive' ? <path d="M11 9h2m-2 3h2m-2 3h2m-2 3h2" /> : kind === 'audio' ? <><path d="M13 17v-6l3 1" /><circle cx="11" cy="17" r="2" /></> : kind === 'video' ? <path d="m10 11 6 4-6 4v-8Z" /> : kind === 'pdf' ? <path d="M9 18v-7h3a2 2 0 0 1 0 4H9" /> : null}
    </>}
  </chakra.svg>
}
