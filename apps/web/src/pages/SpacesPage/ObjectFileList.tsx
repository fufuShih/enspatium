import { Box, Button, Flex, Heading, Text, chakra } from '@chakra-ui/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { downloadObject, getListObjectsQueryKey, useListObjects } from '../../api/generated/objects'
import { ActionButton, PageLink, TextInput } from '../../components/ui/Primitives'
import RequestState from '../../components/RequestState'
import { useAuth } from '../../context/auth'
import { apiStatus } from '../../context/session'
import { fileErrorMessage, fileListLimit, fileSizeLimit, formatFileSize, uploadFile } from './objectFileApi'
import { spacePath } from './spaceApi'

export default function ObjectFileList({ account, slug }: { account: string; slug: string }) {
  const { user } = useAuth()
  const client = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const uploadController = useRef<AbortController | null>(null)
  const downloadController = useRef<AbortController | null>(null)
  const [filter, setFilter] = useState('')
  const [prefix, setPrefix] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState<string | null>(null)
  const params = { limit: fileListLimit, ...(prefix ? { prefix } : {}) }
  const files = useListObjects(account, slug, params, { query: {
    enabled: Boolean(user), retry: false,
    queryKey: [...getListObjectsQueryKey(account, slug, params), user?.id ?? null],
  } })
  const upload = useMutation({
    mutationFn: ({ file, signal }: { file: File; signal: AbortSignal }) => uploadFile(account, slug, file, signal),
    retry: false, gcTime: 0,
  })

  useEffect(() => () => {
    uploadController.current?.abort()
    downloadController.current?.abort()
  }, [])

  async function refreshSession(failure: unknown) {
    if (apiStatus(failure) === 401) await client.invalidateQueries({ queryKey: ['session'] })
  }

  async function handleUpload(file: File) {
    if (uploadController.current) return
    setError('')
    setNotice('')
    if (file.size > fileSizeLimit) { setError('Choose a file smaller than or equal to 100 MiB.'); return }
    const controller = new AbortController()
    uploadController.current = controller
    try {
      await upload.mutateAsync({ file, signal: controller.signal })
      if (controller.signal.aborted) return
      setNotice(`Uploaded ${file.name}.`)
      // Clear filters so the refreshed list can include the new file.
      setFilter('')
      setPrefix('')
      await client.invalidateQueries({ queryKey: getListObjectsQueryKey(account, slug) })
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(fileErrorMessage(failure, 'upload'))
        await refreshSession(failure)
      }
    } finally {
      uploadController.current = null
      upload.reset()
    }
  }

  async function handleDownload(key: string) {
    if (downloadController.current) return
    const controller = new AbortController()
    downloadController.current = controller
    setDownloading(key)
    setError('')
    try {
      const blob = await downloadObject(account, slug, key, { signal: controller.signal })
      if (controller.signal.aborted) return
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = key.split('/').at(-1) || 'download'
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(fileErrorMessage(failure, 'download'))
        await refreshSession(failure)
      }
    } finally {
      downloadController.current = null
      setDownloading(null)
    }
  }

  return (
    <Box as="section" aria-label="Files">
      <Flex justify="space-between" align="center" gap="16px" mb="20px">
        <Box><Heading as="h2" fontSize="20px" fontWeight="600">Files</Heading><Text mt="6px" fontSize="12px" color="var(--muted)">Up to 100 MiB per file.</Text></Box>
        {user && !files.isError && <>
          <chakra.input ref={input} type="file" display="none" aria-label="Choose a file to upload" onChange={event => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void handleUpload(file)
          }} />
          <ActionButton loading={upload.isPending} loadingText="Uploading..." disabled={files.isPending} onClick={() => input.current?.click()} bg="var(--foreground)" color="var(--background)">Upload file</ActionButton>
        </>}
      </Flex>
      {upload.isPending && <Text role="status" mb="16px" fontSize="13px" color="var(--muted)" overflowWrap="anywhere">Uploading {upload.variables?.file.name}...</Text>}
      {notice && <Text role="status" mb="16px" fontSize="13px" bg="bg.success" color="fg.success" p="12px 14px" borderRadius="8px" overflowWrap="anywhere">{notice}</Text>}
      {error && <Text role="alert" mb="16px" fontSize="13px" bg="bg.error" color="fg.error" p="12px 14px" borderRadius="8px">{error}</Text>}
      {!user ? <RequestState title="Sign in to view files"><ActionButton asChild mt="20px"><PageLink to="/login" state={{ from: spacePath(account, slug) }}>Sign in</PageLink></ActionButton></RequestState> : <>
        <Flex asChild gap="10px" mb="20px">
          <form onSubmit={event => { event.preventDefault(); setPrefix(filter); setNotice('') }}>
            <TextInput type="search" aria-label="Filter by filename prefix" placeholder="Filename starts with..." maxLength={1024} value={filter} onChange={event => setFilter(event.target.value)} minW="0" />
            <ActionButton type="submit">Filter</ActionButton>
            {prefix && <ActionButton type="button" onClick={() => { setFilter(''); setPrefix('') }}>Clear</ActionButton>}
          </form>
        </Flex>
        {files.isPending ? <RequestState loading title="Loading files..." /> : files.isError ? <RequestState title="Unable to load files" message={fileErrorMessage(files.error, 'list')} onRetry={() => { void files.refetch() }} /> : !files.data.length ? <RequestState title={prefix ? 'No matching files' : 'No files yet'} message={prefix ? 'Try another filename prefix.' : 'Upload a file to get started.'} /> : <>
          <Box as="ul" listStyleType="none" m="0" p="0" border="1px solid color-mix(in srgb, var(--border) 60%, transparent)" borderRadius="8px" overflow="hidden">
            {files.data.map(file => <Box as="li" key={file.id} _notFirst={{ borderTop: '1px solid color-mix(in srgb, var(--border) 50%, transparent)' }}>
              <Flex align="center" gap="16px" p="14px 16px">
                <Button variant="plain" minW="0" h="auto" p="0" flex="1" justifyContent="flex-start" fontWeight="500" fontSize="13px" color="var(--foreground)" textAlign="left" whiteSpace="normal" overflowWrap="anywhere" aria-label={`Download ${file.key}`} loading={downloading === file.key} loadingText="Downloading..." disabled={downloading !== null} onClick={() => { void handleDownload(file.key) }} _hover={{ textDecoration: 'underline' }}>{file.key}</Button>
                <Text fontSize="12px" color="var(--muted)" whiteSpace="nowrap">{formatFileSize(file.sizeBytes)}</Text>
              </Flex>
            </Box>)}
          </Box>
          {files.data.length === fileListLimit && <Text mt="12px" fontSize="12px" color="var(--muted)">Showing the first 100 files. Filter by filename to narrow the list.</Text>}
        </>}
      </>}
    </Box>
  )
}
