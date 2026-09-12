import { Box, Flex, Spinner, Text, chakra } from '@chakra-ui/react'
import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { useNavigate } from 'react-router'
import { ActionButton } from '../../../components/ui/Primitives'
import { objectFolderLocation } from './objectFolderApi'
import { formatFileSize } from './objectFileApi'
import type { ObjectUploads } from './useObjectUploads'

export default function ObjectUploadPanel({ uploads, account, slug, prefix, disabled }: {
  uploads: ObjectUploads; account: string; slug: string; prefix: string; disabled: boolean
}) {
  const filesInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const [dragging, setDragging] = useState(false)
  const [visibleCount, setVisibleCount] = useState(30)
  const navigate = useNavigate()
  const folderSupported = 'webkitdirectory' in HTMLInputElement.prototype
  const busy = uploads.phase !== null
  const locked = disabled || busy
  const successCount = uploads.items.filter(item => item.status === 'uploaded').length
  const failedCount = uploads.items.filter(item => item.status === 'failed').length
  const stoppedCount = uploads.items.filter(item => item.status === 'stopped').length
  const finishedCount = successCount + failedCount + stoppedCount
  const retryable = uploads.items.some(item => item.retryable && (item.status === 'failed' || item.status === 'stopped'))

  function showDestination() {
    setVisibleCount(30)
    navigate(objectFolderLocation(account, slug, prefix), { replace: true })
  }

  function handleFiles(files: File[], folder = false) {
    if (locked || (!folder && !files.length)) return
    void uploads.addFiles(files, prefix)
    showDestination()
  }

  function isFileDrag(event: DragEvent) { return Array.from(event.dataTransfer.types).includes('Files') }

  return <Box mb="24px">
    <Box
      aria-label="File upload area"
      border="1px dashed" borderColor={dragging && !locked ? 'var(--accent-ink)' : 'var(--border)'}
      borderRadius="8px" bg={dragging && !locked ? 'var(--surface)' : 'transparent'} p={{ base: '16px', md: '20px' }}
      onDragEnter={event => { if (isFileDrag(event)) { event.preventDefault(); dragDepth.current++; setDragging(true) } }}
      onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = isFileDrag(event) && !locked ? 'copy' : 'none' }}
      onDragLeave={event => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false) }}
      onDrop={event => {
        event.preventDefault(); event.stopPropagation(); dragDepth.current = 0; setDragging(false)
        if (locked) return
        void uploads.drop(event.dataTransfer, prefix)
        showDestination()
      }}
    >
      <Flex align="center" justify="space-between" gap="16px" wrap="wrap">
        <Box flex="1" minW="160px">
          <Text fontSize="13px" fontWeight="500">{uploads.phase === 'reading' ? 'Reading files and folders...' : dragging && !locked ? 'Drop to upload here' : 'Drop files or folders here'}</Text>
          <Text mt="5px" fontSize="12px" color="var(--muted)" lineHeight="1.7">Folder structure is kept. Empty folders are skipped.</Text>
        </Box>
        <Flex gap="8px" wrap="wrap">
          <chakra.input ref={filesInput} type="file" multiple display="none" aria-label="Choose a file to upload" disabled={locked}
            onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; handleFiles(files) }} />
          <chakra.input ref={(element: HTMLInputElement | null) => { folderInput.current = element; if (element && folderSupported) element.webkitdirectory = true }} type="file" multiple display="none" aria-label="Choose a folder to upload" disabled={locked || !folderSupported}
            onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; handleFiles(files, true) }} />
          {uploads.phase === 'reading' && <ActionButton onClick={uploads.stop}>Stop reading</ActionButton>}
          <ActionButton disabled={locked || !folderSupported} title={folderSupported ? undefined : 'Folder selection is unavailable in this browser.'} onClick={() => folderInput.current?.click()}>Upload folder</ActionButton>
          <ActionButton disabled={locked} onClick={() => filesInput.current?.click()} bg="var(--foreground)" color="var(--background)">Upload files</ActionButton>
        </Flex>
      </Flex>
    </Box>
    {uploads.items.length > 0 && <Box as="section" aria-label="Upload list" mt="16px" border="1px solid var(--border)" borderRadius="8px" overflow="hidden">
      <Flex px="16px" py="12px" align="center" justify="space-between" gap="12px" wrap="wrap" bg="var(--surface)">
        <Box minW="0" flex="1">
          <Text fontSize="13px" fontWeight="500" role="status">{successCount} of {uploads.items.length} uploaded{failedCount ? ` · ${failedCount} failed` : ''}{stoppedCount ? ` · ${stoppedCount} stopped` : ''}</Text>
          <Text mt="4px" fontSize="12px" color="var(--muted)" overflowWrap="anywhere">To: {uploads.destination || 'All files'}</Text>
        </Box>
        <Flex gap="8px">
          {busy ? <ActionButton onClick={uploads.stop}>Stop uploads</ActionButton> : <>
            {retryable && <ActionButton disabled={disabled} onClick={() => uploads.retry()}>Retry remaining</ActionButton>}
            <ActionButton onClick={uploads.clear}>Clear list</ActionButton>
          </>}
        </Flex>
      </Flex>
      <Box role="progressbar" aria-label="Files processed" aria-valuemin={0} aria-valuemax={uploads.items.length} aria-valuenow={finishedCount} h="3px" bg="var(--surface-strong)"><Box h="full" bg="var(--accent-ink)" w={`${100 * finishedCount / uploads.items.length}%`} /></Box>
      <Box as="ul" aria-label="Upload items" listStyleType="none" p="0" m="0" maxH="320px" overflowY="auto">
        {uploads.items.slice(0, visibleCount).map(item => <Box as="li" key={item.id} p="12px 16px" _notFirst={{ borderTop: '1px solid var(--border)' }}>
          <Flex align="center" gap="12px">
            <Box flex="1" minW="0"><Text fontSize="13px" overflowWrap="anywhere">{item.path}</Text>
              {item.message && <Text mt="4px" fontSize="12px" lineHeight="1.7" color={item.status === 'failed' ? 'fg.error' : 'var(--muted)'} overflowWrap="anywhere">{item.message}</Text>}
            </Box>
            <Flex align="center" gap="8px" flexShrink="0">
              {item.status === 'uploading' && <Spinner size="xs" />}
              <Text fontSize="11px" color={item.status === 'failed' ? 'fg.error' : 'var(--muted)'}>{item.status === 'queued' ? 'Waiting' : item.status === 'uploading' ? 'Uploading' : item.status === 'uploaded' ? 'Uploaded' : item.status === 'stopped' ? 'Stopped' : 'Failed'}</Text>
              {!busy && item.retryable && (item.status === 'failed' || item.status === 'stopped') && <ActionButton disabled={disabled} p="5px 8px" aria-label={`Retry ${item.path}`} onClick={() => uploads.retry(item.id)}>Retry</ActionButton>}
            </Flex>
          </Flex>
          {item.size !== undefined && <Text mt="3px" fontSize="11px" color="var(--muted)">{formatFileSize(item.size)}</Text>}
        </Box>)}
      </Box>
      {visibleCount < uploads.items.length && <ActionButton m="12px" onClick={() => setVisibleCount(count => count + 30)}>Show more files</ActionButton>}
    </Box>}
    {uploads.phase === 'reading' && <Text role="status" mt="12px" fontSize="13px" color="var(--muted)">Reading files and folders...</Text>}
    {uploads.notice && <Text role="status" mt="12px" fontSize="13px" color="var(--muted)" overflowWrap="anywhere">{uploads.notice}</Text>}
    {uploads.emptyFolders > 0 && <Text mt="8px" fontSize="12px" color="var(--muted)">{uploads.emptyFolders} empty {uploads.emptyFolders === 1 ? 'folder' : 'folders'} skipped.</Text>}
    {uploads.error && <Text role="alert" mt="12px" p="12px" bg="bg.error" color="fg.error" borderRadius="6px" fontSize="13px">{uploads.error}</Text>}
  </Box>
}
