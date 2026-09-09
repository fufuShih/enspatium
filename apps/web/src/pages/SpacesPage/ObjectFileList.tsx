import { Box, Button, Flex, Heading, Text, chakra } from '@chakra-ui/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Fragment, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { downloadObject, getBrowseObjectsQueryKey, useBrowseObjects } from '../../api/generated/objects'
import { ActionButton, PageLink, TextInput } from '../../components/ui/Primitives'
import RequestState from '../../components/RequestState'
import { useAuth } from '../../context/auth'
import { apiCode, apiStatus } from '../../context/session'
import { fileErrorMessage, fileListLimit, fileSizeLimit, formatFileSize, refreshObjectLists, uploadFile } from './objectFileApi'
import { newObjectFolder, objectBreadcrumbs, objectFolderLocation } from './objectFolderApi'
import type { ListObjects200Item } from '../../api/generated/api.schemas'
import ObjectFileViewer from './ObjectFileViewer'
import ObjectFileIcon from './ObjectFileIcon'
import { objectFileKind } from './objectPreview'
import { storageErrorTitle } from './storageErrors'

export default function ObjectFileList({ account, slug }: { account: string; slug: string }) {
  const [search] = useSearchParams()
  const prefix = search.get('path') || ''
  return <ObjectFolder key={prefix} account={account} slug={slug} prefix={prefix} />
}

function ObjectFolder({ account, slug, prefix }: { account: string; slug: string; prefix: string }) {
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const nameFilter = search.get('filter') || ''
  const cursor = search.get('cursor') || ''
  const crumbs = objectBreadcrumbs(prefix)
  const location = (path = prefix, filter = nameFilter, after = '') => objectFolderLocation(account, slug, path, filter, after)
  const [folderName, setFolderName] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const { user } = useAuth()
  const client = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const uploadController = useRef<AbortController | null>(null)
  const downloadController = useRef<AbortController | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState('')
  const [selected, setSelected] = useState<ListObjects200Item | null>(null)
  const previewTrigger = useRef<HTMLElement | null>(null)
  const params = { limit: fileListLimit, prefix, filter: nameFilter, ...(cursor ? { cursor } : {}) }
  const files = useBrowseObjects(account, slug, params, { query: {
    enabled: Boolean(user), retry: false,
    queryKey: [...getBrowseObjectsQueryKey(account, slug, params), user?.id ?? null],
  } })
  const upload = useMutation({
    mutationFn: ({ file, signal }: { file: File; signal: AbortSignal }) => uploadFile(account, slug, file, signal, prefix),
    retry: false, gcTime: 0,
  })

  useEffect(() => () => {
    uploadController.current?.abort()
    downloadController.current?.abort()
  }, [])

  async function refreshSession(failure: unknown) {
    if (apiCode(failure) === 'SPACE_STORAGE_UNAVAILABLE') await refreshObjectLists(client, account, slug)
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
      navigate(location(prefix, ''), { replace: true })
      await refreshObjectLists(client, account, slug)
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
    setDownloadError('')
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
        setDownloadError(fileErrorMessage(failure, 'download'))
        await refreshSession(failure)
      }
    } finally {
      downloadController.current = null
      setDownloading(null)
    }
  }

  return (
    <Box as="section" aria-label="Files">
      <Flex justify="space-between" align="center" wrap="wrap" gap="16px" mb="20px">
        <Box><Heading as="h2" fontSize="20px" fontWeight="600">Files</Heading><Text mt="6px" fontSize="12px" color="var(--muted)">Up to 100 MiB per file.</Text></Box>
        {user && !files.isError && <Flex gap="8px">
          <ActionButton disabled={upload.isPending} onClick={() => { setCreatingFolder(value => !value); setError('') }}>New folder</ActionButton>
          <chakra.input ref={input} type="file" display="none" aria-label="Choose a file to upload" onChange={event => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void handleUpload(file)
          }} />
          <ActionButton loading={upload.isPending} loadingText="Uploading..." disabled={files.isPending} onClick={() => input.current?.click()} bg="var(--foreground)" color="var(--background)">Upload file</ActionButton>
        </Flex>}
      </Flex>
      <Box as="nav" aria-label="Folder path" fontSize="13px" color="var(--muted)" mb="20px" overflowWrap="anywhere">
        <PageLink to={location('', '')} aria-current={!prefix ? 'page' : undefined}>All files</PageLink>
        {crumbs.map((crumb, index) => <Fragment key={crumb.prefix}><Text as="span" mx="8px" aria-hidden="true">/</Text><PageLink to={location(crumb.prefix, '')} aria-current={index === crumbs.length - 1 ? 'page' : undefined}>{crumb.name}</PageLink></Fragment>)}
      </Box>
      {prefix && <PageLink to={location(crumbs.at(-2)?.prefix || '', '')} display="inline-block" mb="20px" fontSize="13px">Back to parent folder</PageLink>}
      {creatingFolder && <Box asChild mb="20px" p="16px" border="1px solid var(--border)" borderRadius="8px"><form onSubmit={event => {
        event.preventDefault()
        const next = newObjectFolder(prefix, folderName)
        if (!next) { setError('Enter a valid folder name without slashes or reserved characters.'); return }
        if (files.data?.objects.some(file => file.key === prefix + folderName)) { setError('A file already uses this name. Choose another folder name.'); return }
        navigate(location(next, ''))
      }}>
        <chakra.label htmlFor="new-folder-name" fontSize="13px">Folder name</chakra.label>
        <Flex gap="8px" mt="8px" wrap="wrap"><TextInput id="new-folder-name" value={folderName} onChange={event => setFolderName(event.target.value)} required maxLength={255} autoFocus /><ActionButton type="submit">Open folder</ActionButton><ActionButton type="button" onClick={() => setCreatingFolder(false)}>Cancel</ActionButton></Flex>
        <Text mt="10px" fontSize="12px" color="var(--muted)">Upload a file to make this folder appear in the list.</Text>
      </form></Box>}
      {upload.isPending && <Text role="status" mb="16px" fontSize="13px" color="var(--muted)" overflowWrap="anywhere">Uploading {upload.variables?.file.name}...</Text>}
      {notice && <Text role="status" mb="16px" fontSize="13px" bg="bg.success" color="fg.success" p="12px 14px" borderRadius="8px" overflowWrap="anywhere">{notice}</Text>}
      {error && <Text role="alert" mb="16px" fontSize="13px" bg="bg.error" color="fg.error" p="12px 14px" borderRadius="8px">{error}</Text>}
      {downloadError && !selected && <Text role="alert" mb="16px" fontSize="13px" color="fg.error">{downloadError}</Text>}
      {!user ? <RequestState title="Sign in to view files"><ActionButton asChild mt="20px"><PageLink to="/login" state={{ from: location(prefix, nameFilter, cursor) }}>Sign in</PageLink></ActionButton></RequestState> : <>
        <ObjectNameFilter key={nameFilter} initialFilter={nameFilter} onFilter={value => { navigate(location(prefix, value)); setNotice('') }} />
        {files.isPending ? <RequestState loading title="Loading files..." /> : files.isError ? <RequestState title={storageErrorTitle(files.error, 'Unable to load files')} message={fileErrorMessage(files.error, 'list')} onRetry={() => { void files.refetch() }} /> : !files.data.objects.length && !files.data.folders.length ? <RequestState title={nameFilter ? 'No matching files or folders' : cursor ? 'No more files' : prefix ? 'This folder is empty' : 'No files yet'} message={nameFilter ? 'Try another filename prefix.' : 'Upload a file to get started.'} /> : <>
          <Box as="ul" listStyleType="none" m="0" p="0" border="1px solid color-mix(in srgb, var(--border) 60%, transparent)" borderRadius="8px" overflow="hidden">
            {files.data.folders.map(folder => <Box as="li" key={folder} _notFirst={{ borderTop: '1px solid var(--border)' }}>
              <PageLink to={location(folder, '')} display="flex" alignItems="center" gap="12px" p="16px" fontSize="13px" _hover={{ bg: 'var(--surface)' }} aria-label={`Open folder ${folder}`}><ObjectFileIcon kind="folder" /><Text flex="1" minW="0" overflowWrap="anywhere">{folder.slice(prefix.length, -1)}</Text><Text fontSize="12px" color="var(--muted)">Folder</Text></PageLink>
            </Box>)}
            {files.data.objects.map(file => <Box as="li" key={file.id} _notFirst={{ borderTop: '1px solid color-mix(in srgb, var(--border) 50%, transparent)' }}>
              <Flex align="center" gap="12px" p="12px 16px" _hover={{ bg: 'var(--surface)' }}>
                <Button variant="plain" minW="0" h="auto" p="0" flex="1" gap="12px" justifyContent="flex-start" fontWeight="500" fontSize="13px" color="var(--foreground)" textAlign="left" whiteSpace="normal" aria-label={`Open ${file.key}`} onClick={event => { previewTrigger.current = event.currentTarget; setDownloadError(''); setSelected(file) }} _hover={{ textDecoration: 'underline' }}><ObjectFileIcon kind={objectFileKind(file)} /><Text minW="0" overflowWrap="anywhere">{file.key.slice(prefix.length)}</Text></Button>
                <Text fontSize="12px" color="var(--muted)" whiteSpace="nowrap">{formatFileSize(file.sizeBytes)}</Text>
                <ActionButton aria-label={`Download ${file.key}`} title="Download" p="7px" borderColor="transparent" loading={downloading === file.key} disabled={downloading !== null} onClick={() => { void handleDownload(file.key) }}><ObjectFileIcon kind="download" /></ActionButton>
              </Flex>
            </Box>)}
          </Box>
        </>}
        {(cursor || files.data?.nextCursor) && <Flex justify="flex-end" gap="8px" mt="16px">
          {cursor && <ActionButton asChild><PageLink to={location()}>First page</PageLink></ActionButton>}
          {files.data?.nextCursor && <ActionButton asChild><PageLink to={location(prefix, nameFilter, files.data.nextCursor)}>Next page</PageLink></ActionButton>}
        </Flex>}
      </>}
      {selected && <ObjectFileViewer key={selected.id} account={account} slug={slug} file={selected} downloading={downloading !== null} downloadError={downloadError} onDownload={() => { void handleDownload(selected.key) }} onDeleted={() => { setNotice(`Deleted ${selected.key}.`); setSelected(null) }} onClose={() => setSelected(null)} returnFocus={() => previewTrigger.current} />}
    </Box>
  )
}

function ObjectNameFilter({ initialFilter, onFilter }: { initialFilter: string; onFilter: (value: string) => void }) {
  const [value, setValue] = useState(initialFilter)
  return <Flex asChild gap="10px" mb="20px">
    <form onSubmit={event => { event.preventDefault(); onFilter(value) }}>
      <TextInput type="search" aria-label="Filter by filename prefix" placeholder="Name starts with..." maxLength={1024} value={value} onChange={event => setValue(event.target.value)} minW="0" />
      <ActionButton type="submit">Filter</ActionButton>
      {initialFilter && <ActionButton type="button" onClick={() => onFilter('')}>Clear</ActionButton>}
    </form>
  </Flex>
}
