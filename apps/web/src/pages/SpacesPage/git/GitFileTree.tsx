import { Box, Flex, Text, chakra } from '@chakra-ui/react'
import { useEffect, useState } from 'react'
import type { GetGitSpaceTree200 } from '../../../api/generated/api.schemas'
import { getGetGitSpaceCommitQueryKey, useGetGitSpaceCommit } from '../../../api/generated/spaces'
import { PageLink } from '../../../components/ui/Primitives'
import { useAuth } from '../../../context/auth'
import { sortGitEntries } from './gitBrowserApi'
import { gitReadRetry } from './gitReadQuery'
import { gitHistoryLocation } from './gitHistoryApi'
import { gitRelativeTime } from './gitTime'
import GitIcon from './GitIcon'

function CommitTime({ value, now }: { value: string; now: number }) {
  const fullDate = new Date(value).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'long' })
  return <chakra.time dateTime={value} title={fullDate} tabIndex={0} aria-label={fullDate} fontSize="12px" color="var(--muted)" whiteSpace="nowrap" cursor="help">{gitRelativeTime(value, now)}</chakra.time>
}

export default function GitFileTree({ account, slug, tree, commitUrl, commitState, parentUrl, location }: {
  account: string; slug: string; tree: GetGitSpaceTree200; commitUrl: string; parentUrl?: string
  commitState: { gitRef: { name: string; type: 'branch' | 'tag' } }
  location: (path: string, file: boolean, commit: string) => string
}) {
  const { user } = useAuth()
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer) }, [])
  const params = { ref: tree.commitId }
  const commit = useGetGitSpaceCommit(account, slug, params, { query: { ...gitReadRetry,
    queryKey: [...getGetGitSpaceCommitQueryKey(account, slug, params), user?.id ?? null],
  } })
  return <Box border="1px solid var(--border)" borderRadius="8px" overflow="hidden">
    <Flex aria-label="Latest commit" align="center" gap="10px" px="16px" py="10px" bg="var(--surface)" borderBottom="1px solid var(--border)" minW="0">
      <Flex w="22px" h="22px" flexShrink="0" borderRadius="full" align="center" justify="center" bg="var(--surface-strong)" color="var(--accent-ink)" fontSize="11px" fontWeight="600" aria-hidden="true">{commit.data?.authorName.slice(0, 1).toUpperCase() || <GitIcon name="commit" size={14} />}</Flex>
      {commit.data && <Text fontSize="12px" fontWeight="500" maxW="140px" truncate display={{ base: 'none', md: 'block' }} title={commit.data.authorName}>{commit.data.authorName}</Text>}
      <PageLink to={commitUrl} state={commitState} flex="1" minW="0" truncate fontSize="13px" title={commit.data?.message}>{commit.data?.message.split('\n')[0] || (commit.isPending ? 'Loading latest commit…' : 'View commit')}</PageLink>
      <PageLink to={commitUrl} state={commitState} aria-label={`View commit ${tree.commitId.slice(0, 7)}`} fontFamily="mono" fontSize="12px" color="var(--muted)" flexShrink="0" display={{ base: 'none', sm: 'block' }}>{tree.commitId.slice(0, 7)}</PageLink>
      {commit.data && <CommitTime value={commit.data.committedAt} now={now} />}
    </Flex>
    <Box as="ul" aria-label="Repository files" listStyleType="none" m="0" p="0">
      {parentUrl && <Box as="li" borderBottom="1px solid var(--border)"><PageLink to={parentUrl} aria-label="Back to parent folder" display="flex" alignItems="center" gap="12px" p="10px 16px" color="var(--muted)" _hover={{ bg: 'var(--surface)' }}><GitIcon name="directory" /><Text fontSize="13px">..</Text></PageLink></Box>}
      {sortGitEntries(tree.entries).map((entry, index) => <Box as="li" key={entry.path} borderTop={index ? '1px solid color-mix(in srgb, var(--border) 55%, transparent)' : undefined} display="grid" gridTemplateColumns={{ base: 'minmax(0, 1fr) auto', md: 'minmax(140px, 1fr) minmax(0, 1.5fr) 110px' }} columnGap="20px" rowGap="4px" px="16px" py="10px" alignItems="center" _hover={{ bg: 'var(--surface)' }}>
        <Flex minW="0" gap="10px" align="center">
          <Box display="flex" color={entry.type === 'directory' ? 'var(--accent-ink)' : 'var(--muted)'}><GitIcon name={entry.type} /></Box>
          {entry.type === 'submodule' ? <Text truncate fontSize="13px" title={`${entry.name} (submodule)`}>{entry.name}</Text> : <PageLink to={location(entry.path, entry.type !== 'directory', tree.commitId)} aria-label={entry.type === 'directory' ? `${entry.name}/ Folder` : undefined} truncate fontSize="13px" title={entry.name}>{entry.name}{entry.type === 'directory' ? '/' : ''}</PageLink>}
        </Flex>
        <Box minW="0" gridRow={{ base: '2', md: '1' }} gridColumn={{ base: '1 / -1', md: '2' }} pl={{ base: '26px', md: '0' }}>
          {entry.lastCommit ? <PageLink to={gitHistoryLocation(account, slug, commitState.gitRef.name, { commit: entry.lastCommit.id })} state={commitState} display="block" truncate color="var(--muted)" fontSize="12px" title={entry.lastCommit.message} aria-label={`View commit for ${entry.name}: ${entry.lastCommit.message || 'Untitled commit'}`}>{entry.lastCommit.message || 'Untitled commit'}</PageLink> : <Text fontSize="12px" color="var(--muted)">Commit unavailable</Text>}
        </Box>
        <Box textAlign="right" gridColumn={{ base: '2', md: '3' }} gridRow="1">{entry.lastCommit && <CommitTime value={entry.lastCommit.committedAt} now={now} />}</Box>
      </Box>)}
      {!tree.entries.length && <Box as="li" p="32px" textAlign="center" fontSize="13px" color="var(--muted)">This folder is empty</Box>}
    </Box>
    <Text px="16px" py="9px" borderTop="1px solid var(--border)" fontSize="11px" color="var(--muted)">{tree.entries.length} {tree.entries.length === 1 ? 'item' : 'items'}</Text>
  </Box>
}
