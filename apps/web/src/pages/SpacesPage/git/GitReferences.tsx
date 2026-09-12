import { Box, Flex, Heading, Text, chakra } from '@chakra-ui/react'
import { useSearchParams } from 'react-router'
import { getListGitSpaceReferencesQueryKey, useListGitSpaceReferences } from '../../../api/generated/spaces'
import { ActionButton, PageLink, TextInput } from '../../../components/ui/Primitives'
import RequestState from '../../../components/RequestState'
import { useAuth } from '../../../context/auth'
import { gitErrorMessage, gitLocation, type GitRefType } from './gitBrowserApi'
import { gitHistoryLocation } from './gitHistoryApi'
import { gitReadRetry } from './gitReadQuery'

export default function GitReferences({ account, slug, type, defaultBranch }: { account: string; slug: string; type: GitRefType; defaultBranch: string }) {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const offset = Math.min(1_000_000, Math.max(0, Number(params.get('offset')) || 0))
  const search = params.get('search') || ''
  const query = { type, search, offset: Math.floor(offset), limit: 30 }
  const refs = useListGitSpaceReferences(account, slug, query, { query: { ...gitReadRetry, queryKey: [...getListGitSpaceReferencesQueryKey(account, slug, query), user?.id ?? null] } })
  const update = (search: string, offset: number) => {
    const next = new URLSearchParams(params)
    next.delete('offset'); next.delete('search')
    if (offset) next.set('offset', String(offset))
    if (search) next.set('search', search)
    setParams(next)
  }
  return <Box as="section" aria-label="Reference list" minW="0">
    <Flex justify="space-between" align="center" mb="16px" gap="12px">
      <Heading as="h2" fontSize="16px" fontWeight="500">{type === 'tag' ? 'Tags' : 'Branches'}{refs.data ? ` (${refs.data.total})` : ''}</Heading>
      <ActionButton disabled={refs.isFetching} onClick={() => { void refs.refetch() }}>Refresh</ActionButton>
    </Flex>
    <chakra.form mb="20px" onSubmit={event => { event.preventDefault(); update(String(new FormData(event.currentTarget).get('search') || '').trim(), 0) }}>
      <Flex gap="8px"><TextInput key={`${type}:${search}`} name="search" aria-label="Search references" placeholder="Search by name" defaultValue={search} maxLength={255} minW="0" /><ActionButton type="submit">Search</ActionButton></Flex>
    </chakra.form>
    {refs.isPending ? <RequestState loading title="Loading references..." /> : refs.isError ? <RequestState title="Unable to load references" message={gitErrorMessage(refs.error)} onRetry={() => { void refs.refetch() }} /> : <>
      {!refs.data.items.length ? <RequestState title="No references found" message={search ? 'Try another name or clear the search.' : 'Push a branch or tag to see it here.'} /> : <Box as="ul" listStyleType="none" m="0" p="0" border="1px solid var(--border)" borderRadius="8px" overflow="hidden">
        {refs.data.items.map((ref, index) => <Box as="li" key={ref.name} p="16px" borderTop={index ? '1px solid var(--border)' : undefined}>
          <Flex align="baseline" justify="space-between" gap="12px" wrap="wrap">
            <PageLink to={gitLocation(account, slug, ref.name, '', false, '', type)} fontSize="14px" fontWeight="500" overflowWrap="anywhere">{ref.name}</PageLink>
            {type === 'branch' && ref.name === defaultBranch && <Text fontSize="11px" color="var(--muted)">Default</Text>}
          </Flex>
          <PageLink to={gitHistoryLocation(account, slug, ref.name, { refType: type, commit: ref.commit.id, snapshot: ref.commit.id })} display="block" mt="8px" fontSize="13px" overflowWrap="anywhere"><Text as="span" fontFamily="mono" mr="8px" color="var(--muted)">{ref.commit.shortId}</Text>{ref.commit.message || 'Untitled commit'}</PageLink>
          <Flex mt="8px" gap="12px" justify="space-between" align="baseline" wrap="wrap" fontSize="12px" color="var(--muted)">
            <Text overflowWrap="anywhere">{ref.commit.authorName} · Last commit <chakra.time dateTime={ref.commit.committedAt}>{new Date(ref.commit.committedAt).toLocaleString('en-US')}</chakra.time></Text>
            <PageLink to={gitHistoryLocation(account, slug, ref.name, { refType: type })}>History</PageLink>
          </Flex>
        </Box>)}
      </Box>}
      <Flex align="center" justify="space-between" mt="16px" gap="12px" fontSize="12px"><Text color="var(--muted)">Page {Math.floor(offset / 30) + 1}</Text><Flex gap="8px">{offset > 0 && <ActionButton onClick={() => update(search, Math.max(0, offset - 30))}>Previous</ActionButton>}{refs.data.hasMore && <ActionButton onClick={() => update(search, offset + 30)}>Next</ActionButton>}</Flex></Flex>
      <Text mt="16px" fontSize="12px" color="var(--muted)">Times show each reference's latest commit, not its push time.</Text>
    </>}
  </Box>
}
