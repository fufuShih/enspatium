import { Box, Flex, Heading, Text, chakra } from '@chakra-ui/react'
import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { getGetGitSpaceDiffQueryKey, useGetGitSpaceDiff } from '../../../api/generated/spaces'
import { ActionButton, PageLink, SelectInput } from '../../../components/ui/Primitives'
import RequestState from '../../../components/RequestState'
import { useAuth } from '../../../context/auth'
import { gitRevision } from './gitBrowserApi'
import { gitHistoryError, gitHistoryLocation } from './gitHistoryApi'
import { comparisonOptions, gitCompareLocation, parseComparisonRef } from './gitCompareApi'
import { gitReadRetry } from './gitReadQuery'
import GitDiffView from './GitDiffView'

export default function GitCompare({ account, slug, branches, tags, defaultBranch }: { account: string; slug: string; branches: string[]; tags: string[]; defaultBranch: string }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const names = [...branches.map(name => gitRevision(name)), ...tags.map(name => gitRevision(name, 'tag'))]
  const defaultFrom = branches.includes(defaultBranch) ? gitRevision(defaultBranch) : names[0] || ''
  const options = comparisonOptions(params, defaultFrom, names.find(name => name !== defaultFrom) || defaultFrom)
  const { from, to, base, head, file } = options
  const fromRef = parseComparisonRef(from)
  const toRef = parseComparisonRef(to)
  const ready = Boolean(fromRef && toRef && ((base && head) || (names.includes(from) && names.includes(to))))
  const query = { from: base || from, to: head || to }
  const diff = useGetGitSpaceDiff(account, slug, query, { query: { enabled: ready, ...gitReadRetry, queryKey: [...getGetGitSpaceDiffQueryKey(account, slug, query), user?.id ?? null] } })
  const baseId = diff.data?.from?.commitId
  const headId = diff.data?.to.commitId
  // Pin both endpoints together before navigating files or reloading. New pushes
  // cannot silently change an existing comparison link.
  useEffect(() => {
    if (diff.isSuccess && !diff.isFetching && !base && !head && baseId && headId) navigate(gitCompareLocation(account, slug, { from, to, base: baseId, head: headId, file }), { replace: true })
  }, [account, slug, from, to, base, head, file, baseId, headId, diff.isSuccess, diff.isFetching, navigate])
  const latest = () => { navigate(gitCompareLocation(account, slug, { from, to })); if (!base && !head && ready) void diff.refetch() }
  const selector = (label: string, value: string, side: 'from' | 'to') => <Box flex="1" minW="0">
    <chakra.label htmlFor={`compare-${side}`} display="block" mb="8px" fontSize="12px" color="var(--muted)">{label}</chakra.label>
    <SelectInput id={`compare-${side}`} value={value} onChange={event => navigate(gitCompareLocation(account, slug, { from, to, [side]: event.target.value }))}>
      {!names.includes(value) && <option value={value} disabled>{value ? `${parseComparisonRef(value)?.name || value} (unavailable)` : 'No references'}</option>}
      {branches.length > 0 && <optgroup label="Branches">{branches.map(name => <option key={name} value={gitRevision(name)}>Branch: {name}</option>)}</optgroup>}
      {tags.length > 0 && <optgroup label="Tags">{tags.map(name => <option key={name} value={gitRevision(name, 'tag')}>Tag: {name}</option>)}</optgroup>}
    </SelectInput>
  </Box>
  return <Box as="section" aria-label="Version comparison" minW="0">
    <Heading as="h2" fontSize="16px" fontWeight="500" mb="8px">Compare versions</Heading>
    <Text fontSize="13px" color="var(--muted)" mb="20px">Changes from Base to Target, comparing their file contents directly.</Text>
    <Flex gap="16px" direction={{ base: 'column', sm: 'row' }} mb="16px">{selector('Base', from, 'from')}{selector('Target', to, 'to')}</Flex>
    <Flex gap="8px" mb="24px" wrap="wrap">
      <ActionButton disabled={!from || !to} onClick={() => navigate(gitCompareLocation(account, slug, { from: to, to: from, base: head, head: base }))}>Swap</ActionButton>
      <ActionButton disabled={!names.includes(from) || !names.includes(to) || diff.isFetching} onClick={latest}>Refresh comparison</ActionButton>
    </Flex>
    {!ready ? <RequestState title={names.length ? 'Reference unavailable' : 'No references to compare'} message="Choose an existing branch or tag for both sides." /> : diff.isPending ? <RequestState loading title="Comparing versions..." /> : diff.isError ? <RequestState title="Comparison unavailable" message={gitHistoryError(diff.error)} onRetry={() => { void diff.refetch() }} /> : <>
      <Flex gap="8px" align="center" wrap="wrap" mb="20px" fontFamily="mono" fontSize="12px" aria-label="Compared commits">
        <PageLink to={gitHistoryLocation(account, slug, fromRef!.name, { refType: fromRef!.type, commit: baseId, snapshot: baseId })}>{baseId?.slice(0, 7)}</PageLink><Text as="span" color="var(--muted)">→</Text><PageLink to={gitHistoryLocation(account, slug, toRef!.name, { refType: toRef!.type, commit: headId, snapshot: headId })}>{headId?.slice(0, 7)}</PageLink>
      </Flex>
      <GitDiffView patch={diff.data.patch} selectedPath={file} fileLocation={file => gitCompareLocation(account, slug, { from, to, base: baseId, head: headId, file })} emptyMessage="These versions contain the same files." />
    </>}
  </Box>
}
