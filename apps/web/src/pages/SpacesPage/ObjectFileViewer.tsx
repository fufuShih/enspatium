import { Box, Dialog, Flex, Portal, Text, chakra } from '@chakra-ui/react'
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ListObjects200Item } from '../../api/generated/api.schemas'
import { deleteObject, downloadObjectVersion } from '../../api/generated/objects'
import { ActionButton } from '../../components/ui/Primitives'
import RequestState from '../../components/RequestState'
import { apiStatus } from '../../context/session'
import { fileErrorMessage, formatFileSize, refreshObjectLists } from './objectFileApi'
import { decodeObjectText, imagePreviewLimit, objectFileKind, objectPreviewKind, textPreviewLimit } from './objectPreview'
import ObjectFileIcon from './ObjectFileIcon'
import ObjectVersions from './ObjectVersions'
import { storageErrorTitle } from './storageErrors'

type Preview = { kind: 'loading' } | { kind: 'text'; text: string } | { kind: 'image'; url: string } | { kind: 'unavailable'; message: string } | { kind: 'error'; title: string; message: string }

export default function ObjectFileViewer({ account, slug, file: currentFile, downloading, downloadError, onDownload, onClose, onDeleted, onRestored, returnFocus }: {
  account: string; slug: string; file: ListObjects200Item; downloading: boolean; downloadError: string
  onDownload: (version: ListObjects200Item) => void; onClose: () => void; onDeleted: () => void; onRestored: () => void; returnFocus: () => HTMLElement | null
}) {
  const client = useQueryClient()
  const [file, setFile] = useState(currentFile)
  const [showVersions, setShowVersions] = useState(currentFile.isDeleted)
  const [restoring, setRestoring] = useState(false)
  const [preview, setPreview] = useState<Preview>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  async function handleDelete() {
    setDeleting(true)
    setDeleteError('')
    try {
      await deleteObject(account, slug, currentFile.key, { expectedVersion: currentFile.versionId })
      await refreshObjectLists(client, account, slug)
      onDeleted()
    } catch (error) {
      setDeleteError(fileErrorMessage(error, 'delete'))
      if (apiStatus(error) === 401) void client.invalidateQueries({ queryKey: ['session'] })
    } finally { setDeleting(false) }
  }

  useEffect(() => {
    const controller = new AbortController()
    let imageUrl: string | undefined
    const kind = objectPreviewKind(file)
    const limit = kind === 'image' ? imagePreviewLimit : textPreviewLimit
    async function load() {
      if (file.isDeleted) { setPreview({ kind: 'unavailable', message: 'This file was deleted. Choose a version below to preview or restore.' }); return }
      if (!kind) { setPreview({ kind: 'unavailable', message: 'Download this file to open it on your device.' }); return }
      if (file.sizeBytes > limit) { setPreview({ kind: 'unavailable', message: `${kind === 'image' ? 'Image' : 'Text'} previews are limited to ${formatFileSize(limit)}. You can still download this file.` }); return }
      setPreview({ kind: 'loading' })
      try {
        const blob = await downloadObjectVersion(account, slug, { key: file.key, versionId: file.versionId }, { signal: controller.signal })
        if (controller.signal.aborted) return
        if (blob.size > limit) { setPreview({ kind: 'unavailable', message: 'This file is too large to preview. Download it to view its contents.' }); return }
        if (kind === 'image') {
          imageUrl = URL.createObjectURL(blob)
          setPreview({ kind: 'image', url: imageUrl })
        } else {
          const bytes = await blob.arrayBuffer()
          if (controller.signal.aborted) return
          try { setPreview({ kind: 'text', text: decodeObjectText(bytes) }) }
          catch { setPreview({ kind: 'unavailable', message: 'This file could not be read as text. Download it to view its contents.' }) }
        }
      } catch (error) {
        if (controller.signal.aborted) return
        setPreview({ kind: 'error', title: storageErrorTitle(error, 'Unable to load preview'), message: fileErrorMessage(error, 'preview') })
        if (apiStatus(error) === 401) void client.invalidateQueries({ queryKey: ['session'] })
      }
    }
    void load()
    return () => { controller.abort(); if (imageUrl) URL.revokeObjectURL(imageUrl) }
  }, [account, slug, file, attempt, client])

  return <Dialog.Root open onOpenChange={({ open }) => { if (!open && !deleting && !restoring) onClose() }} placement="center" scrollBehavior="inside" finalFocusEl={returnFocus}>
    <Portal>
      <Dialog.Backdrop bg="blackAlpha.600" />
      <Dialog.Positioner p={{ base: '12px', md: '24px' }}>
        <Dialog.Content maxW="900px" w="100%" maxH="calc(100dvh - 48px)" m="0" bg="var(--background)" color="var(--foreground)" border="1px solid var(--border)" borderRadius="12px" overflow="hidden" css={{ '& :is(button, pre):focus-visible': { outline: '2px solid var(--muted)', outlineOffset: '3px' } }}>
          <Dialog.Header p={{ base: '20px', md: '24px' }} borderBottom="1px solid var(--border)">
            <Flex align="start" gap="12px" w="100%">
              <Box pt="2px" color="var(--muted)"><ObjectFileIcon kind={objectFileKind(file)} /></Box>
              <Box minW="0" flex="1"><Dialog.Title fontSize="17px" fontWeight="500" overflowWrap="anywhere">{file.key}</Dialog.Title><Dialog.Description mt="6px" fontSize="12px" color="var(--muted)">Version {file.revision}{file.versionId === currentFile.versionId ? ' · Current' : ' · Historical'}</Dialog.Description></Box>
              <Dialog.CloseTrigger asChild position="static"><ActionButton aria-label="Close preview" disabled={deleting || restoring} p="6px 10px" fontSize="18px">×</ActionButton></Dialog.CloseTrigger>
            </Flex>
          </Dialog.Header>
          <Dialog.Body p={{ base: '20px', md: '24px' }} minW="0">
            <Box as="dl" display="grid" gridTemplateColumns={{ base: '1fr', sm: 'auto auto auto' }} gap="16px" m="0" mb="24px" fontSize="12px">
              {[['Size', formatFileSize(file.sizeBytes)], ['Content type', file.contentType], ['Last modified', new Date(file.updatedAt).toLocaleString('en-US')]].map(([label, value]) => <Box key={label}><Box as="dt" color="var(--muted)" mb="4px">{label}</Box><Box as="dd" m="0" overflowWrap="anywhere">{value}</Box></Box>)}
            </Box>
            <Box border="1px solid var(--border)" borderRadius="8px" overflow="hidden" minW="0">
              {preview.kind === 'loading' ? <RequestState loading title="Loading preview..." /> : preview.kind === 'error' ? <RequestState title={preview.title} message={preview.message} onRetry={() => setAttempt(value => value + 1)} /> : preview.kind === 'unavailable' ? <RequestState title="Preview unavailable" message={preview.message} /> : preview.kind === 'text' ? preview.text === '' ? <RequestState title="This file is empty" /> : <Box as="pre" aria-label="File contents" tabIndex={0} m="0" p="16px" fontSize="12px" lineHeight="1.8" maxH="50dvh" overflow="auto"><Box as="code" fontFamily="mono">{preview.text}</Box></Box> : <Flex p="16px" minH="160px" justify="center" bg="var(--surface)"><chakra.img src={preview.url} alt={file.key} maxW="100%" maxH="50dvh" objectFit="contain" onError={() => setPreview({ kind: 'unavailable', message: 'This image could not be displayed. Download it to open it on your device.' })} /></Flex>}
            </Box>
            {downloadError && <Text role="alert" mt="16px" fontSize="13px" color="fg.error">{downloadError}</Text>}
            {deleteError && <Text role="alert" mt="16px" fontSize="13px" color="fg.error">{deleteError}</Text>}
            {confirmDelete && <Text mt="16px" fontSize="13px">Move this file to Deleted files? Content can be recovered until retention cleanup permanently removes it.</Text>}
            <ActionButton mt="20px" disabled={restoring || deleting} aria-expanded={showVersions} onClick={() => setShowVersions(value => !value)}>Versions</ActionButton>
            {showVersions && !confirmDelete && <ObjectVersions account={account} slug={slug} fileKey={currentFile.key} selectedId={file.versionId} onSelect={setFile} onRestored={onRestored} onBusy={setRestoring} />}
          </Dialog.Body>
          <Dialog.Footer p="16px 24px" borderTop="1px solid var(--border)" flexWrap="wrap">
            {confirmDelete ? <><ActionButton disabled={deleting || restoring} onClick={() => { setConfirmDelete(false); setDeleteError('') }}>Cancel</ActionButton><ActionButton color="fg.error" loading={deleting} loadingText="Deleting..." onClick={() => { void handleDelete() }}>Confirm delete</ActionButton></> : <>
              <ActionButton color="fg.error" mr="auto" disabled={downloading || restoring || currentFile.isDeleted} onClick={() => setConfirmDelete(true)}>Delete file</ActionButton>
              <ActionButton loading={downloading} loadingText="Downloading..." disabled={file.isDeleted || restoring} onClick={() => onDownload(file)} gap="8px"><ObjectFileIcon kind="download" />Download</ActionButton>
            </>}
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Positioner>
    </Portal>
  </Dialog.Root>
}
