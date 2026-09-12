import { gitReadRetry } from './gitReadQuery'
import { gitRevision } from './gitBrowserApi'
import { Box, Flex, Heading, Text, chakra } from '@chakra-ui/react'
import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import {
  getListGitSpaceCommitsQueryKey, useListGitSpaceCommits,
  getGetGitSpaceCommitQueryKey, useGetGitSpaceCommit,
  getGetGitSpaceDiffQueryKey, useGetGitSpaceDiff,
} from '../../../api/generated/spaces'
import { ActionButton, PageLink } from '../../../components/ui/Primitives'
import RequestState from '../../../components/RequestState'
import { useAuth } from '../../../context/auth'
import { storageErrorTitle } from '../shared/storageErrors'
import { type HistoryLocation, commitPageSize, gitHistoryError, gitHistoryLocation, historyOptions, maxDiffPreviewLines, parseGitPatch } from './gitHistoryApi'

export default function GitHistory({ account, slug, branch }: { account: string; slug: string; branch: string }) {
  const { user } = useAuth()
  const viewer = user?.id ?? null
  const [params] = useSearchParams()
  const options = historyOptions(params)
  const { commit, offset = 0, snapshot, file: selectedPath } = options
  const location = (changes: HistoryLocation = {}) => gitHistoryLocation(account, slug, branch, { ...options, ...changes })
  const listParams = { ref: snapshot || gitRevision(branch, options.refType), offset, limit: commitPageSize }
  const history = useListGitSpaceCommits(account, slug, listParams, { query: {
    enabled: !commit, ...gitReadRetry, queryKey: [...getListGitSpaceCommitsQueryKey(account, slug, listParams), viewer],
  } })
  const commitParams = { ref: commit || '' }
  const detail = useGetGitSpaceCommit(account, slug, commitParams, { query: {
    enabled: Boolean(commit), ...gitReadRetry, queryKey: [...getGetGitSpaceCommitQueryKey(account, slug, commitParams), viewer],
  } })
  // Resolve the detail first, then pin the diff to its immutable commit ID.
  const diffParams = { to: detail.data?.id || '' }
  const diff = useGetGitSpaceDiff(account, slug, diffParams, { query: {
    enabled: Boolean(commit) && detail.isSuccess, ...gitReadRetry, queryKey: [...getGetGitSpaceDiffQueryKey(account, slug, diffParams), viewer],
  } })
  const files = useMemo(() => parseGitPatch(diff.data?.patch ?? ''), [diff.data?.patch])
  const selected = selectedPath ? files.find(file => file.path === selectedPath) : files[0]
  const active = commit ? detail : history

  return <Box as="section" aria-label={commit ? 'Commit details' : 'Commit history'} minW="0">
    {commit && <PageLink to={location({ commit: undefined, file: undefined })} display="inline-block" mb="20px" fontSize="13px">Back to commits</PageLink>}
    {active.isPending ? <RequestState loading title={commit ? 'Loading commit...' : 'Loading commits...'} /> : active.isError ? <RequestState title={storageErrorTitle(active.error, 'Unable to load commits')} message={gitHistoryError(active.error)} onRetry={() => { void active.refetch() }} /> : !commit && history.data ? <>
      <Flex justify="space-between" align="center" gap="16px" mb="16px">
        <Heading as="h2" fontSize="16px" fontWeight="500">Commits</Heading>
        <PageLink to={gitHistoryLocation(account, slug, branch, { refType: options.refType })} fontSize="12px" onClick={() => { if (!snapshot && !offset) void history.refetch() }}>Latest commits</PageLink>
      </Flex>
      {!history.data.commits.length ? <RequestState title="No commits on this page" /> : <Box as="ul" listStyleType="none" m="0" p="0" border="1px solid var(--border)" borderRadius="8px" overflow="hidden">
        {history.data.commits.map((item, index) => <Box as="li" key={item.id} borderTop={index ? '1px solid var(--border)' : undefined}>
          <PageLink to={location({ commit: item.id, snapshot: history.data.commitId })} display="block" p="16px" _hover={{ bg: 'var(--surface)' }}>
            <Flex justify="space-between" align="baseline" gap="16px"><Text fontSize="14px" fontWeight="500" overflowWrap="anywhere">{item.message || 'Untitled commit'}</Text><Text fontFamily="mono" fontSize="12px" flexShrink="0" color="var(--muted)">{item.shortId}</Text></Flex>
            <Text mt="6px" fontSize="12px" color="var(--muted)" overflowWrap="anywhere">{item.authorName} · <chakra.time dateTime={item.authoredAt}>{new Date(item.authoredAt).toLocaleString('en-US')}</chakra.time></Text>
          </PageLink>
        </Box>)}
      </Box>}
      <Flex mt="16px" justify="space-between" align="center" fontSize="12px" gap="12px">
        <Text color="var(--muted)">Page {Math.floor(offset / commitPageSize) + 1}</Text>
        <Flex gap="8px">
          {offset > 0 && <ActionButton asChild><PageLink to={location({ offset: Math.max(0, offset - commitPageSize), snapshot: history.data.commitId })}>Newer</PageLink></ActionButton>}
          {history.data.hasMore && <ActionButton asChild><PageLink to={location({ offset: offset + commitPageSize, snapshot: history.data.commitId })}>Older</PageLink></ActionButton>}
        </Flex>
      </Flex>
    </> : detail.data ? <>
      <Box mb="24px">
        <Heading as="h2" fontSize="18px" fontWeight="500" whiteSpace="pre-wrap" overflowWrap="anywhere">{detail.data.message || 'Untitled commit'}</Heading>
        <Text mt="10px" fontSize="13px" color="var(--muted)" overflowWrap="anywhere">{detail.data.authorName} · <chakra.time dateTime={detail.data.authoredAt}>{new Date(detail.data.authoredAt).toLocaleString('en-US')}</chakra.time></Text>
        <Text mt="8px" fontSize="12px" fontFamily="mono" overflowWrap="anywhere">{detail.data.id}</Text>
        <Text mt="8px" fontSize="12px" color="var(--muted)">{detail.data.parentIds.length > 1 ? 'Merge commit · Changes compared with the first parent.' : !detail.data.parentIds.length ? 'Initial commit' : 'Changes compared with the parent commit.'}</Text>
      </Box>
      {diff.isPending ? <RequestState loading title="Loading changes..." /> : diff.isError ? <RequestState title={storageErrorTitle(diff.error, 'Diff preview unavailable')} message={gitHistoryError(diff.error)} onRetry={() => { void diff.refetch() }} /> : !files.length ? <RequestState title="No file changes" message="This commit does not change any files compared with its parent." /> : <>
        <Heading as="h3" fontSize="14px" fontWeight="500" mb="12px">{files.length} changed {files.length === 1 ? 'file' : 'files'}</Heading>
        <Box as="nav" aria-label="Changed files" border="1px solid var(--border)" borderRadius="8px" overflow="hidden" mb="20px" maxH="280px" overflowY="auto">
          {files.map((file, index) => <PageLink key={index} to={location({ file: file.path })} display="flex" alignItems="center" justifyContent="space-between" gap="12px" p="12px 16px" borderTop={index ? '1px solid var(--border)' : undefined} bg={selected === file ? 'var(--surface)' : undefined} aria-current={selected === file ? 'page' : undefined} _hover={{ bg: 'var(--surface)' }}>
            <Text fontSize="13px" overflowWrap="anywhere">{file.status === 'Renamed' ? `${file.oldPath} → ${file.path}` : file.path}</Text>
            <Flex gap="12px" align="center" flexShrink="0" fontSize="12px"><Text color="var(--muted)">{file.status}</Text>{!file.binary && <Text fontFamily="mono">+{file.additions} −{file.deletions}</Text>}</Flex>
          </PageLink>)}
        </Box>
        {!selected ? <RequestState title="File not found in this commit" message="Choose a changed file above." /> : <Box border="1px solid var(--border)" borderRadius="8px" overflow="hidden">
          <Text px="16px" py="12px" fontSize="13px" borderBottom="1px solid var(--border)" overflowWrap="anywhere">{selected.path}</Text>
          {selected.binary ? <RequestState title="Binary file changed" message="Text differences are not available for this file." /> : <Box role="region" aria-label="File diff" overflowX="auto" maxH="640px" tabIndex={0} fontFamily="mono" fontSize="12px" lineHeight="1.8">
            <Box minW="max-content">
              {selected.lines.slice(0, maxDiffPreviewLines).map((line, index) => <Flex key={index} bg={line.kind === 'added' ? 'color-mix(in srgb, #22c55e 14%, var(--background))' : line.kind === 'removed' ? 'color-mix(in srgb, #ef4444 14%, var(--background))' : line.kind === 'meta' ? 'var(--surface)' : undefined}>
                <Text as="span" w="52px" flexShrink="0" textAlign="right" pr="8px" color="var(--muted)" userSelect="none" aria-hidden="true">{line.oldLine ?? ''}</Text>
                <Text as="span" w="52px" flexShrink="0" textAlign="right" pr="12px" color="var(--muted)" userSelect="none" aria-hidden="true">{line.newLine ?? ''}</Text>
                <Box as="code" display="block" whiteSpace="pre" pr="16px" fontFamily="inherit" css={{ tabSize: 2 }}>{line.text}</Box>
              </Flex>)}
            </Box>
          </Box>}
          {selected.lines.length > maxDiffPreviewLines && <Text p="16px" fontSize="12px" color="var(--muted)">Showing the first {maxDiffPreviewLines.toLocaleString('en-US')} diff lines. Clone the repository to view the full changes.</Text>}
        </Box>}
      </>}
    </> : null}
  </Box>
}
