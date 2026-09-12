import { Box, Flex, Heading, Text } from '@chakra-ui/react'
import { Fragment } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import {
  getGetGitSpaceInfoQueryKey, getGetGitSpaceTreeQueryKey, getGetGitSpaceReadmeQueryKey,
  useGetGitSpaceInfo, useGetGitSpaceTree, useGetGitSpaceReadme,
  getDownloadGitSpaceArchiveUrl,
} from '../../../api/generated/spaces'
import { ActionButton, PageLink, SelectInput } from '../../../components/ui/Primitives'
import RequestState from '../../../components/RequestState'
import { useAuth } from '../../../context/auth'
import { apiStatus } from '../../../context/session'
import { defaultGitBranch, gitArchiveRef, gitErrorMessage, gitLocation, sortGitEntries } from './gitBrowserApi'
import { formatFileSize } from '../object/objectFileApi'
import GitReadme from './GitReadme'
import GitHistory from './GitHistory'
import { gitHistoryLocation } from './gitHistoryApi'
import { storageErrorTitle } from '../shared/storageErrors'
import { EmptyGitRepository, GitCloneMenu } from './GitRepositoryActions'
import GitFileView from './GitFileView'

export default function GitBrowser({ account, slug }: { account: string; slug: string }) {
  const { user } = useAuth()
  const viewer = user?.id ?? null
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const info = useGetGitSpaceInfo(account, slug, { query: { retry: false, queryKey: [...getGetGitSpaceInfoQueryKey(account, slug), viewer] } })
  const branch = params.get('ref') || (info.data ? defaultGitBranch(info.data) : '')
  const path = params.get('path') || ''
  const isFile = params.get('view') === 'file'
  const isHistory = params.get('view') === 'commits'
  const fileCommit = isFile ? params.get('commit') || '' : ''
  const ready = info.isSuccess && (info.data.branches.includes(branch) || Boolean(fileCommit))
  const revision = `refs/heads/${branch}`
  const treeParams = { ref: revision, path }
  const tree = useGetGitSpaceTree(account, slug, treeParams, { query: { enabled: ready && !isHistory && !isFile, retry: false, queryKey: [...getGetGitSpaceTreeQueryKey(account, slug, treeParams), viewer] } })
  // Pin README to the displayed tree so a concurrent push cannot mix revisions.
  const readmeParams = { ref: tree.data?.commitId ?? revision }
  const readme = useGetGitSpaceReadme(account, slug, readmeParams, { query: { enabled: ready && !isHistory && !isFile && !path && tree.isSuccess, retry: false, queryKey: [...getGetGitSpaceReadmeQueryKey(account, slug, readmeParams), viewer] } })
  const root = gitLocation(account, slug, branch)
  const segments = path.split('/').filter(Boolean)
  const parent = gitLocation(account, slug, branch, segments.slice(0, -1).join('/'))
  // Use the same origin and API proxy as the generated client.
  const cloneUrl = new URL(`/api/git/${encodeURIComponent(account)}/${encodeURIComponent(slug)}.git`, window.location.origin).href

  if (info.isPending) return <RequestState loading title="Loading repository..." />
  if (info.isError) return <RequestState title={storageErrorTitle(info.error, 'Unable to load repository')} message={gitErrorMessage(info.error)} onRetry={() => { void info.refetch() }} />
  if (!info.data.branches.length && !fileCommit) return <Box minW="0">
    <Flex align="center" justify="space-between" gap="16px" mb="20px"><Text fontSize="13px" color="var(--muted)">Repository</Text><GitCloneMenu url={cloneUrl} /></Flex>
    <EmptyGitRepository url={cloneUrl} refreshing={info.isFetching} onRefresh={() => { void info.refetch() }} />
  </Box>
  if (!ready && !(isHistory && params.get('commit'))) return <RequestState title="Branch not found" message="Choose an existing branch to continue."><ActionButton asChild mt="20px"><PageLink to={gitLocation(account, slug, defaultGitBranch(info.data))}>Back to repository</PageLink></ActionButton></RequestState>

  const content = tree
  const archiveRef = gitArchiveRef(params, branch, tree.isSuccess ? tree.data.commitId : undefined)
  return (
    <Box as="section" aria-label="Repository browser" minW="0">
      <Flex align="center" wrap="wrap" gap="16px" mb="20px">
        <SelectInput aria-label="Branch" w={{ base: '100%', sm: '200px' }} value={branch} onChange={event => navigate(isHistory ? gitHistoryLocation(account, slug, event.target.value) : gitLocation(account, slug, event.target.value))}>
          {fileCommit && !info.data.branches.includes(branch) && <option value={branch} disabled>{branch || 'Commit snapshot'}</option>}
          {info.data.branches.map(name => <option key={name} value={name}>{name}</option>)}
        </SelectInput>
        <Box display={isHistory ? 'none' : undefined} as="nav" aria-label="Repository path" fontSize="13px" color="var(--muted)" minW="0" flex="1" overflowWrap="anywhere">
          <PageLink to={root} aria-current={!path ? 'page' : undefined}>{slug}</PageLink>
          {segments.map((part, index) => <Fragment key={index}><Text as="span" mx="8px" aria-hidden="true">/</Text>{index === segments.length - 1 ? <Text as="span" aria-current="page" color="var(--foreground)">{part}</Text> : <PageLink to={gitLocation(account, slug, branch, segments.slice(0, index + 1).join('/'))}>{part}</PageLink>}</Fragment>)}
        </Box>
        <Box ml="auto"><GitCloneMenu url={cloneUrl} archiveRef={archiveRef} archiveUrl={archiveRef ? getDownloadGitSpaceArchiveUrl(account, slug, { ref: archiveRef }) : undefined} /></Box>
      </Flex>
      <Flex as="nav" aria-label="Repository views" gap="24px" mb="24px" borderBottom="1px solid var(--border)" fontSize="13px">
        <PageLink to={root} pb="12px" borderBottom={!isHistory ? '2px solid var(--foreground)' : '2px solid transparent'} color={!isHistory ? 'var(--foreground)' : 'var(--muted)'} aria-current={!isHistory ? 'page' : undefined}>Files</PageLink>
        <PageLink to={gitHistoryLocation(account, slug, branch)} pb="12px" borderBottom={isHistory ? '2px solid var(--foreground)' : '2px solid transparent'} color={isHistory ? 'var(--foreground)' : 'var(--muted)'} aria-current={isHistory ? 'page' : undefined}>Commits</PageLink>
      </Flex>
      {isHistory ? <GitHistory account={account} slug={slug} branch={branch} /> : <>
      {path && <PageLink to={parent} display="inline-block" mb="16px" fontSize="13px" color="var(--muted)">Back to parent folder</PageLink>}
      {isFile ? <GitFileView key={`${branch}:${path}`} account={account} slug={slug} branch={branch} path={path} commit={fileCommit} /> : content.isPending ? <RequestState loading title="Loading files..." /> : content.isError ? <RequestState title={storageErrorTitle(content.error, apiStatus(content.error) === 413 ? 'Preview unavailable' : 'Unable to open path')} message={gitErrorMessage(content.error)} onRetry={() => { void content.refetch() }}>
        {apiStatus(content.error) === 401 && <ActionButton asChild mt="20px" ml="12px"><PageLink to="/login" state={{ from: gitLocation(account, slug, branch, path, isFile) }}>Sign in</PageLink></ActionButton>}
        <PageLink to={root} display="block" mt="20px" fontSize="13px">Back to repository</PageLink>
      </RequestState> : tree.data ? <>
        <Box border="1px solid var(--border)" borderRadius="8px" overflow="hidden">
          <Flex justify="space-between" gap="16px" px="16px" py="12px" bg="var(--surface)" fontSize="12px"><Text>Repository files</Text><Text color="var(--muted)">{tree.data.entries.length} {tree.data.entries.length === 1 ? 'item' : 'items'}</Text></Flex>
          {!tree.data.entries.length ? <RequestState title="This folder is empty" /> : <Box as="ul" listStyleType="none" m="0" p="0">
            {sortGitEntries(tree.data.entries).map(entry => <Box as="li" key={entry.path} borderTop="1px solid color-mix(in srgb, var(--border) 55%, transparent)">
              {entry.type === 'submodule' ? <Flex p="14px 16px" justify="space-between" gap="16px" fontSize="13px"><Text overflowWrap="anywhere">{entry.name}</Text><Text color="var(--muted)" fontSize="12px">Submodule</Text></Flex> : <PageLink to={gitLocation(account, slug, branch, entry.path, entry.type !== 'directory', tree.data.commitId)} display="flex" alignItems="center" justifyContent="space-between" gap="16px" p="14px 16px" fontSize="13px" _hover={{ bg: 'var(--surface)' }}>
                <Text overflowWrap="anywhere">{entry.name}{entry.type === 'directory' ? '/' : ''}</Text><Text color="var(--muted)" fontSize="12px" flexShrink="0">{entry.type === 'directory' ? 'Folder' : entry.type === 'symlink' ? 'Symlink' : entry.size === null ? 'File' : formatFileSize(entry.size)}</Text>
              </PageLink>}
            </Box>)}
          </Box>}
        </Box>
        {!path && <Box mt="24px">
          {readme.isPending ? <RequestState loading title="Loading README..." /> : readme.isError ? <RequestState title={storageErrorTitle(readme.error, 'Unable to load README')} message={gitErrorMessage(readme.error)} onRetry={() => { void readme.refetch() }} /> : readme.data ? <Box as="section" aria-label="README" border="1px solid var(--border)" borderRadius="8px" overflow="hidden">
            <Flex p="12px 16px" borderBottom="1px solid var(--border)" justify="space-between" gap="16px" fontSize="12px"><Heading as="h2" fontSize="12px" fontWeight="500">{readme.data.name}</Heading><PageLink to={gitLocation(account, slug, branch, readme.data.path, true, readme.data.commitId)}>View source</PageLink></Flex>
            {readme.data.encoding === 'base64' ? <RequestState title="README preview unavailable" message="This README is not a text file." /> : <GitReadme file={readme.data} />}
          </Box> : <Text fontSize="13px" color="var(--muted)">No README in this branch.</Text>}
        </Box>}
      </> : null}
      </>}
    </Box>
  )
}
