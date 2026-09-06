import { Box, Flex, Text } from '@chakra-ui/react'
import { useParams } from 'react-router'
import { getGetSpaceQueryKey, useGetSpace } from '../../api/generated/spaces'
import { ActionButton, PageContainer, PageHeading, PageLink } from '../../components/ui/Primitives'
import AuthStatus from '../../components/AuthStatus'
import RequestState from '../../components/RequestState'
import { useAuth } from '../../context/auth'
import { apiStatus } from '../../context/session'
import { namespacePath } from '../UserPage/namespaces'
import { spaceErrorMessage, spacePath } from './spaceApi'

export default function SpacePage() {
  const { account = '', spaceSlug = '' } = useParams()
  const { user, isLoading, error: sessionError } = useAuth()
  const query = useGetSpace(account, spaceSlug, { query: {
    enabled: Boolean(account && spaceSlug) && !isLoading,
    retry: false,
    queryKey: [...getGetSpaceQueryKey(account, spaceSlug), user?.id ?? null],
  } })
  if (isLoading || (sessionError && !user)) return <AuthStatus />
  if (query.isPending) return <PageContainer><RequestState loading title="Loading Space..." /></PageContainer>
  if (query.isError) {
    const status = apiStatus(query.error)
    return <PageContainer><RequestState title={status === 404 ? 'Space not found' : status === 401 ? 'Sign in to view this Space' : status === 403 ? 'Access denied' : 'Unable to load Space'} message={spaceErrorMessage(query.error)} onRetry={status === 401 ? undefined : () => { void query.refetch() }}>
      {status === 401 && <ActionButton asChild mt="20px"><PageLink to="/login" state={{ from: spacePath(account, spaceSlug) }}>Sign in</PageLink></ActionButton>}
      <PageLink to={namespacePath({ account })} display="block" mt="20px" fontSize="13px">Back to profile</PageLink>
    </RequestState></PageContainer>
  }
  const space = query.data
  const details = [
    ['Owner', account],
    ['Type', space.type === 'git' ? 'Git repository' : 'Object storage'],
    ['Visibility', space.visibility === 'public' ? 'Public' : 'Private'],
    ['Created', new Date(space.createdAt).toLocaleString('en-US')],
    ['Updated', new Date(space.updatedAt).toLocaleString('en-US')],
  ]
  return (
    <PageContainer>
      <Box as="nav" aria-label="Breadcrumb" fontSize="13px" color="var(--muted)" overflowWrap="anywhere">
        <PageLink to={namespacePath({ account })}>{account}</PageLink><Text as="span" mx="10px">/</Text><Text as="span" aria-current="page">{space.slug}</Text>
      </Box>
      <Flex align="center" gap="14px" wrap="wrap" mt="24px" mb="32px">
        <PageHeading>{space.name}</PageHeading>
        <Text fontSize="12px" color="var(--muted)" border="1px solid var(--border)" borderRadius="full" px="10px" py="3px">{space.visibility === 'public' ? 'Public' : 'Private'}</Text>
      </Flex>
      <Box as="section" aria-label="Space details" border="1px solid color-mix(in srgb, var(--border) 60%, transparent)" borderRadius="8px" p={{ base: '20px', md: '28px' }}>
        <Box as="dl" display="grid" gridTemplateColumns={{ base: '1fr', sm: '120px minmax(0, 1fr)' }} columnGap="24px" rowGap="12px" fontSize="13px" m="0">
          {details.map(([label, value]) => <Box key={label} display="contents"><Box as="dt" color="var(--muted)">{label}</Box><Box as="dd" m="0" overflowWrap="anywhere" mb={{ base: '8px', sm: '0' }}>{value}</Box></Box>)}
        </Box>
      </Box>
    </PageContainer>
  )
}
