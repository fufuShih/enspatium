import { gitReadRetry } from './gitReadQuery'
import { Box, Flex, Heading, Text } from '@chakra-ui/react'
import { Fragment } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import {
  getGetGitSpaceInfoQueryKey, getGetGitSpaceTreeQueryKey, getGetGitSpaceReadmeQueryKey,
  useGetGitSpaceInfo, useGetGitSpaceTree, useGetGitSpaceReadme,
  getDownloadGitSpaceArchiveUrl,
  getGetGitSpaceTagsQueryKey, useGetGitSpaceTags,
} from '../../../api/generated/spaces'
import { ActionButton, PageLink, SelectInput } from '../../../components/ui/Primitives'
import RequestState from '../../../components/RequestState'
import { useAuth } from '../../../context/auth'
import { apiStatus } from '../../../context/session'
import { defaultGitBranch, gitArchiveRef, gitErrorMessage, gitLocation, gitRefType, gitRevision, sortGitEntries, type GitRefType } from './gitBrowserApi'
import { formatFileSize } from '../object/objectFileApi'
import GitReadme from './GitReadme'
import GitHistory from './GitHistory'
import { gitHistoryLocation } from './gitHistoryApi'
import { storageErrorTitle } from '../shared/storageErrors'
import { EmptyGitRepository, GitCloneMenu } from './GitRepositoryActions'
import GitFileView from './GitFileView'
import GitStorageUsage from './GitStorageUsage'
import GitReferences from './GitReferences'
import GitCompare from './GitCompare'
import { gitCompareLocation } from './gitCompareApi'

export default function GitBrowser({ account, slug }: { account: string; slug: string }) {
  const { user } = useAuth()
  const viewer = user?.id ?? null
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const info = useGetGitSpaceInfo(account, slug, { query: { ...gitReadRetry, queryKey: [...getGetGitSpaceInfoQueryKey(account, slug), viewer] } })
  const tags = useGetGitSpaceTags(account, slug, { query: { enabled: info.isSuccess, ...gitReadRetry, queryKey: [...getGetGitSpaceTagsQueryKey(account, slug), viewer] } })
  const refType = gitRefType(params)
  const names = refType === 'tag' ? tags.data?.map(tag => tag.name) ?? [] : info.data?.branches ?? []
  const branch = params.get('ref') || (refType === 'tag' ? names[0] ?? '' : info.data ? defaultGitBranch(info.data) : '')
  const path = params.get('path') || ''
  const isFile = params.get('view') === 'file'
  const isCompare = params.get('view') === 'compare'
  const isRefs = params.get('view') === 'refs'
  const isHistory = params.get('view') === 'commits'
  const fileCommit = isFile ? params.get('commit') || '' : ''
  const pinned = fileCommit || (isHistory && (params.get('commit') || params.get('snapshot')))
  const ready = info.isSuccess && (names.includes(branch) || Boolean(pinned))
  const revision = gitRevision(branch, refType)
  const treeParams = { ref: revision, path }
  const tree = useGetGitSpaceTree(account, slug, treeParams, { query: { enabled: ready && !isCompare && !isRefs && !isHistory && !isFile, ...gitReadRetry, queryKey: [...getGetGitSpaceTreeQueryKey(account, slug, treeParams), viewer] } })
  // Pin README to the displayed tree so a concurrent push cannot mix revisions.
  const readmeParams = { ref: tree.data?.commitId ?? revision }
  const readme = useGetGitSpaceReadme(account, slug, readmeParams, { query: { enabled: ready && !isCompare && !isRefs && !isHistory && !isFile && !path && tree.isSuccess, ...gitReadRetry, queryKey: [...getGetGitSpaceReadmeQueryKey(account, slug, readmeParams), viewer] } })
  const location = (path = '', file = false, commit = '') => gitLocation(account, slug, branch, path, file, commit, refType)
  const root = location()
  const segments = path.split('/').filter(Boolean)
  const parent = location(segments.slice(0, -1).join('/'))
  const refsLocation = (type: GitRefType = refType) => `${gitLocation(account, slug, '', '', false, '', type)}${type === 'tag' ? '&' : '?'}view=refs`
  const selectRef = (name: string, type: GitRefType = refType) => navigate(isRefs ? refsLocation(type) : isHistory ? gitHistoryLocation(account, slug, name, { refType: type }) : gitLocation(account, slug, name, '', false, '', type))
  // Use the same origin and API proxy as the generated client.
  const cloneUrl = new URL(`/api/git/${encodeURIComponent(account)}/${encodeURIComponent(slug)}.git`, window.location.origin).href

  if (info.isPending) return <RequestState loading title="Loading repository..." />
  if (info.isError) return <RequestState title={storageErrorTitle(info.error, 'Unable to load repository')} message={gitErrorMessage(info.error)} onRetry={() => { void info.refetch() }} />
  if (!info.data.branches.length && !isCompare && !isRefs && !pinned && refType === 'branch') return <Box minW="0">
    <Flex align="center" justify="space-between" gap="16px" mb="20px"><Text fontSize="13px" color="var(--muted)">Repository</Text><GitCloneMenu url={cloneUrl} /></Flex>
    {tags.isPending ? <RequestState loading title="Loading repository..." /> : tags.isError ? <RequestState title="Unable to load tags" message={gitErrorMessage(tags.error)} onRetry={() => { void tags.refetch() }} /> : tags.data.length ? <RequestState title="No branches" message="This repository has tagged versions you can browse."><ActionButton mt="16px" onClick={() => selectRef(tags.data[0]!.name, 'tag')}>Browse tags</ActionButton></RequestState> : <EmptyGitRepository url={cloneUrl} refreshing={info.isFetching || tags.isFetching} onRefresh={() => { void info.refetch(); void tags.refetch() }} />}
    <GitStorageUsage account={account} slug={slug} />
  </Box>

  const content = tree
  const archiveRef = isCompare || isRefs ? undefined : gitArchiveRef(params, branch, tree.isSuccess ? tree.data.commitId : undefined)
  return (
    <Box as="section" aria-label="Repository browser" minW="0">
      <Flex align="center" wrap="wrap" gap="16px" mb="20px">
        {!isCompare && <Flex gap="8px" w={{ base: '100%', sm: '320px' }} minW="0">
          <SelectInput aria-label="Reference type" w="110px" flexShrink="0" value={refType} onChange={event => { const type = event.target.value as GitRefType; selectRef(type === 'tag' ? tags.data?.[0]?.name ?? '' : defaultGitBranch(info.data), type) }}><option value="branch" disabled={!isRefs && !info.data.branches.length}>Branches</option><option value="tag">Tags</option></SelectInput>
          {!isRefs && <SelectInput aria-label={refType === 'tag' ? 'Tag' : 'Branch'} minW="0" value={branch} onChange={event => selectRef(event.target.value)}>
            {!names.includes(branch) && <option value={branch} disabled>{branch || (refType === 'tag' ? 'No tags' : 'No branches')}</option>}
            {names.map(name => <option key={name} value={name}>{name}</option>)}
          </SelectInput>}
        </Flex>}
        <Box display={isCompare || isHistory || isRefs ? 'none' : undefined} as="nav" aria-label="Repository path" fontSize="13px" color="var(--muted)" minW="0" flex="1" overflowWrap="anywhere">
          <PageLink to={root} aria-current={!path ? 'page' : undefined}>{slug}</PageLink>
          {segments.map((part, index) => <Fragment key={index}><Text as="span" mx="8px" aria-hidden="true">/</Text>{index === segments.length - 1 ? <Text as="span" aria-current="page" color="var(--foreground)">{part}</Text> : <PageLink to={location(segments.slice(0, index + 1).join('/'))}>{part}</PageLink>}</Fragment>)}
        </Box>
        <Box ml="auto"><GitCloneMenu url={cloneUrl} archiveRef={archiveRef} archiveUrl={archiveRef ? getDownloadGitSpaceArchiveUrl(account, slug, { ref: archiveRef }) : undefined} /></Box>
      </Flex>
      <Flex as="nav" aria-label="Repository views" gap="24px" mb="24px" borderBottom="1px solid var(--border)" fontSize="13px">
        <PageLink to={root} pb="12px" borderBottom={!isCompare && !isHistory && !isRefs ? '2px solid var(--foreground)' : '2px solid transparent'} color={!isCompare && !isHistory && !isRefs ? 'var(--foreground)' : 'var(--muted)'} aria-current={!isCompare && !isHistory && !isRefs ? 'page' : undefined}>Files</PageLink>
        <PageLink to={gitHistoryLocation(account, slug, branch, { refType })} pb="12px" borderBottom={isHistory ? '2px solid var(--foreground)' : '2px solid transparent'} color={isHistory ? 'var(--foreground)' : 'var(--muted)'} aria-current={isHistory ? 'page' : undefined}>Commits</PageLink>
        <PageLink to={refsLocation()} pb="12px" borderBottom={isRefs ? '2px solid var(--foreground)' : '2px solid transparent'} color={isRefs ? 'var(--foreground)' : 'var(--muted)'} aria-current={isRefs ? 'page' : undefined}>References</PageLink>
        <PageLink to={gitCompareLocation(account, slug, { from: branch ? revision : '', to: '' })} pb="12px" borderBottom={isCompare ? '2px solid var(--foreground)' : '2px solid transparent'} color={isCompare ? 'var(--foreground)' : 'var(--muted)'} aria-current={isCompare ? 'page' : undefined}>Compare</PageLink>
      </Flex>
      {isCompare ? tags.isPending ? <RequestState loading title="Loading references..." /> : tags.isError ? <RequestState title="Unable to load references" message={gitErrorMessage(tags.error)} onRetry={() => { void tags.refetch() }} /> : <GitCompare account={account} slug={slug} branches={info.data.branches} tags={tags.data.map(tag => tag.name)} defaultBranch={info.data.defaultBranch} /> : isRefs ? <GitReferences account={account} slug={slug} type={refType} defaultBranch={info.data.defaultBranch} /> : refType === 'tag' && tags.isPending && !pinned ? <RequestState loading title="Loading tags..." /> : refType === 'tag' && tags.isError && !pinned ? <RequestState title="Unable to load tags" message={gitErrorMessage(tags.error)} onRetry={() => { void tags.refetch() }} /> : !ready ? <RequestState title={refType === 'tag' ? (branch ? 'Tag not found' : 'No tags yet') : 'Branch not found'} message={refType === 'tag' && !branch ? 'Push a Git tag to browse a saved version.' : 'Choose an existing reference to continue.'}><ActionButton mt="16px" onClick={() => { void info.refetch(); void tags.refetch() }}>Refresh references</ActionButton></RequestState> : isHistory ? <GitHistory account={account} slug={slug} branch={branch} /> : <>
      {path && <PageLink to={parent} display="inline-block" mb="16px" fontSize="13px" color="var(--muted)">Back to parent folder</PageLink>}
      {isFile ? <GitFileView key={`${refType}:${branch}:${path}`} account={account} slug={slug} branch={branch} path={path} commit={fileCommit} refType={refType} /> : content.isPending ? <RequestState loading title="Loading files..." /> : content.isError ? <RequestState title={storageErrorTitle(content.error, apiStatus(content.error) === 413 ? 'Preview unavailable' : 'Unable to open path')} message={gitErrorMessage(content.error)} onRetry={() => { void content.refetch() }}>
        {apiStatus(content.error) === 401 && <ActionButton asChild mt="20px" ml="12px"><PageLink to="/login" state={{ from: location(path, isFile) }}>Sign in</PageLink></ActionButton>}
        <PageLink to={root} display="block" mt="20px" fontSize="13px">Back to repository</PageLink>
      </RequestState> : tree.data ? <>
        <Box border="1px solid var(--border)" borderRadius="8px" overflow="hidden">
          <Flex justify="space-between" gap="16px" px="16px" py="12px" bg="var(--surface)" fontSize="12px"><Text>Repository files</Text><Text color="var(--muted)">{tree.data.entries.length} {tree.data.entries.length === 1 ? 'item' : 'items'}</Text></Flex>
          {!tree.data.entries.length ? <RequestState title="This folder is empty" /> : <Box as="ul" listStyleType="none" m="0" p="0">
            {sortGitEntries(tree.data.entries).map(entry => <Box as="li" key={entry.path} borderTop="1px solid color-mix(in srgb, var(--border) 55%, transparent)">
              {entry.type === 'submodule' ? <Flex p="14px 16px" justify="space-between" gap="16px" fontSize="13px"><Text overflowWrap="anywhere">{entry.name}</Text><Text color="var(--muted)" fontSize="12px">Submodule</Text></Flex> : <PageLink to={location(entry.path, entry.type !== 'directory', tree.data.commitId)} display="flex" alignItems="center" justifyContent="space-between" gap="16px" p="14px 16px" fontSize="13px" _hover={{ bg: 'var(--surface)' }}>
                <Text overflowWrap="anywhere">{entry.name}{entry.type === 'directory' ? '/' : ''}</Text><Text color="var(--muted)" fontSize="12px" flexShrink="0">{entry.type === 'directory' ? 'Folder' : entry.type === 'symlink' ? 'Symlink' : entry.size === null ? 'File' : formatFileSize(entry.size)}</Text>
              </PageLink>}
            </Box>)}
          </Box>}
        </Box>
        {!path && <Box mt="24px">
          {readme.isPending ? <RequestState loading title="Loading README..." /> : readme.isError ? <RequestState title={storageErrorTitle(readme.error, 'Unable to load README')} message={gitErrorMessage(readme.error)} onRetry={() => { void readme.refetch() }} /> : readme.data ? <Box as="section" aria-label="README" border="1px solid var(--border)" borderRadius="8px" overflow="hidden">
            <Flex p="12px 16px" borderBottom="1px solid var(--border)" justify="space-between" gap="16px" fontSize="12px"><Heading as="h2" fontSize="12px" fontWeight="500">{readme.data.name}</Heading><PageLink to={location(readme.data.path, true, readme.data.commitId)}>View source</PageLink></Flex>
            {readme.data.encoding === 'base64' ? <RequestState title="README preview unavailable" message="This README is not a text file." /> : <GitReadme file={readme.data} />}
          </Box> : <Text fontSize="13px" color="var(--muted)">No README at this reference.</Text>}
        </Box>}
      </> : null}
      </>}
      <GitStorageUsage account={account} slug={slug} />
    </Box>
  )
}
