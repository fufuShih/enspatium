import { gitReadRetry } from './gitReadQuery'
import { Box, Flex, Text, chakra } from '@chakra-ui/react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import {
  getGetGitSpaceFileInfoQueryKey, getGetGitSpaceFileQueryKey, getGetGitSpaceRawFileUrl,
  useGetGitSpaceFileInfo, useGetGitSpaceFile,
} from '../../../api/generated/spaces'
import { ActionButton } from '../../../components/ui/Primitives'
import RequestState from '../../../components/RequestState'
import { useAuth } from '../../../context/auth'
import { gitErrorMessage, gitLocation } from './gitBrowserApi'
import { formatFileSize } from '../object/objectFileApi'
import { storageErrorTitle } from '../shared/storageErrors'

export default function GitFileView({ account, slug, branch, path, commit }: {
  account: string; slug: string; branch: string; path: string; commit: string
}) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const params = { ref: commit || `refs/heads/${branch}`, path }
  const info = useGetGitSpaceFileInfo(account, slug, params, { query: {
    ...gitReadRetry, gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false,
    queryKey: [...getGetGitSpaceFileInfoQueryKey(account, slug, params), user?.id ?? null],
  } })
  const previewParams = { ref: info.data?.commitId ?? params.ref, path }
  const tooLarge = Boolean(info.data && info.data.size > 1024 * 1024)
  const preview = useGetGitSpaceFile(account, slug, previewParams, { query: {
    enabled: info.isSuccess && !tooLarge, ...gitReadRetry,
    queryKey: [...getGetGitSpaceFileQueryKey(account, slug, previewParams), user?.id ?? null],
  } })
  useEffect(() => {
    if (info.data && commit !== info.data.commitId) navigate(gitLocation(account, slug, branch, path, true, info.data.commitId), { replace: true })
  }, [info.data, commit, account, slug, branch, path, navigate])

  if (info.isPending) return <RequestState loading title="Loading file..." />
  if (info.isError) return <RequestState title={storageErrorTitle(info.error, 'Unable to open file')} message={gitErrorMessage(info.error)} onRetry={() => { void info.refetch() }} />
  const file = info.data
  const raw = getGetGitSpaceRawFileUrl(account, slug, { ref: file.commitId, path: file.path })
  const download = getGetGitSpaceRawFileUrl(account, slug, { ref: file.commitId, path: file.path, download: true })
  return <Box as="section" aria-label="Repository file" border="1px solid var(--border)" borderRadius="8px" overflow="hidden">
    <Flex px="16px" py="12px" borderBottom="1px solid var(--border)" justify="space-between" align="center" gap="16px" wrap="wrap">
      <Box minW="0" flex="1">
        <Text fontSize="13px" overflowWrap="anywhere">{file.name}</Text>
        <Text mt="4px" fontSize="11px" color="var(--muted)">{formatFileSize(file.size)}<Text as="span" mx="8px">·</Text><Text as="span" title={file.commitId}>Commit {file.commitId.slice(0, 7)}</Text></Text>
      </Box>
      <Flex gap="8px">
        <ActionButton asChild><chakra.a href={raw} target="_blank" rel="noopener noreferrer" title="Open raw text in a new tab">Raw</chakra.a></ActionButton>
        <ActionButton asChild><chakra.a href={download} download={file.name} target="_blank" rel="noopener noreferrer">Download</chakra.a></ActionButton>
      </Flex>
    </Flex>
    {tooLarge ? <RequestState title="Preview unavailable" message="This file exceeds the 1 MiB preview limit. Use Raw or Download to open it." />
      : preview.isPending ? <RequestState loading title="Loading preview..." />
      : preview.isError ? <RequestState title={storageErrorTitle(preview.error, 'Unable to preview file')} message={gitErrorMessage(preview.error)} onRetry={() => { void preview.refetch() }} />
      : preview.data.encoding === 'base64' ? <RequestState title="Binary file" message="Download this file to open it." />
      : preview.data.content === '' ? <RequestState title="This file is empty" />
      : <Box as="pre" aria-label="File contents" m="0" p={{ base: '16px', md: '24px' }} overflowX="auto" maxH="640px" tabIndex={0} fontSize="12px" lineHeight="1.8" css={{ tabSize: 2 }}><Box as="code" fontFamily="mono">{preview.data.content}</Box></Box>}
  </Box>
}
