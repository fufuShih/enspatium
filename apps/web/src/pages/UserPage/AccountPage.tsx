import { Box, Flex, Heading, Portal, Text, Tooltip } from '@chakra-ui/react'
import { useParams } from 'react-router'
import { getListNamespacesQueryKey, useGetNamespace, useListNamespaces } from '../../api/generated/namespaces'
import { getListSpacesQueryKey, useListSpaces } from '../../api/generated/spaces'
import { ActionButton, PageContainer, PageLink } from '../../components/ui/Primitives'
import { useAuth } from '../../context/auth'
import AuthStatus from '../../components/AuthStatus'
import RequestState from '../../components/RequestState'
import { apiStatus } from '../../context/session'
import SpacesPage from '../SpacesPage/SpacesPage'
import { spaceErrorMessage } from '../SpacesPage/spaceApi'
import { namespacePath } from './namespaces'

export default function AccountPage() {
  const { account = '' } = useParams()
  const { user, isLoading, error: sessionError } = useAuth()
  const profile = useGetNamespace(account, { query: { enabled: Boolean(account), retry: false } })
  const spaces = useListSpaces(account, { query: { enabled: Boolean(user) && profile.isSuccess, retry: false, queryKey: [...getListSpacesQueryKey(account), user?.id ?? null] } })
  const memberships = useListNamespaces({ query: { enabled: user?.namespace.account === account, retry: false, queryKey: [...getListNamespacesQueryKey(), user?.id ?? null] } })
  const organizations = memberships.data?.filter(item => item.kind === 'organization') ?? []

  if (isLoading || (sessionError && !user)) return <AuthStatus />
  if (profile.isPending) return <PageContainer><RequestState loading title="Loading account..." /></PageContainer>
  if (profile.isError) return <PageContainer><RequestState title={apiStatus(profile.error) === 404 || apiStatus(profile.error) === 400 ? 'Account not found' : 'Unable to load account'} message={spaceErrorMessage(profile.error)} onRetry={() => { void profile.refetch() }}><ActionButton asChild mt="20px" ml="12px"><PageLink to={user ? namespacePath(user.namespace) : '/'}>Go back</PageLink></ActionButton></RequestState></PageContainer>

  const owner = profile.data
  const personal = owner.kind === 'personal'
  return (
    <PageContainer maxW="1120px" display="grid" gridTemplateColumns={{ base: 'minmax(0, 1fr)', md: '220px minmax(0, 1fr)' }} gap={{ base: '28px', md: '48px' }} alignItems="start">
      <Box as="aside" p={{ base: '20px', md: '24px' }} border="1px solid color-mix(in srgb, var(--border) 55%, transparent)" borderRadius="8px" aria-label={personal ? 'User information' : 'Organization information'}>
        <Box display="grid" placeItems="center" boxSize={{ base: '48px', md: '64px' }} mb={{ base: '12px', md: '20px' }} borderRadius={personal ? 'full' : '12px'} bg="var(--surface)" color="var(--foreground)" fontSize={{ base: '22px', md: '26px' }} fontWeight="500" aria-hidden="true">{Array.from(owner.name)[0]?.toUpperCase()}</Box>
        <Heading as="h1" fontSize="21px" fontWeight="600" overflowWrap="anywhere">{owner.name}</Heading>
        <Text mt="4px" color="var(--muted)" fontSize="13px" overflowWrap="anywhere">@{owner.slug}</Text>
        <Text mt="20px" fontSize="11px" color="var(--muted)">{personal ? 'Personal account' : 'Organization'}{spaces.isSuccess && ` · ${spaces.data.length} ${spaces.data.length === 1 ? 'Space' : 'Spaces'}`}</Text>
        {personal && user?.namespace.account === account && (organizations.length > 0 || memberships.isError) && <Box mt="24px" pt="18px" borderTop="1px solid color-mix(in srgb, var(--border) 55%, transparent)">
          <Heading as="h2" mb="10px" fontSize="12px" fontWeight="500" color="var(--muted)">Organizations</Heading>
          {memberships.isError ? <ActionButton onClick={() => { void memberships.refetch() }}>Reload organizations</ActionButton> : <Flex wrap="wrap" gap="8px">
            {organizations.map(organization => <Tooltip.Root key={organization.id} openDelay={200} closeDelay={0} positioning={{ placement: 'bottom' }}>
              <Tooltip.Trigger asChild>
                <PageLink to={namespacePath({ account: organization.slug })} aria-label={organization.name} display="inline-flex" alignItems="center" justifyContent="center" boxSize="32px" border="1px solid transparent" borderRadius="7px" bg="var(--surface)" color="var(--foreground)" fontSize="14px" fontWeight="600" _hover={{ borderColor: 'var(--border)' }}><Box as="span" aria-hidden="true">{Array.from(organization.name)[0]?.toUpperCase()}</Box></PageLink>
              </Tooltip.Trigger>
              <Portal><Tooltip.Positioner><Tooltip.Content bg="var(--foreground)" color="var(--background)" fontSize="xs" px="2.5" py="1.5" borderRadius="md">{organization.name}</Tooltip.Content></Tooltip.Positioner></Portal>
            </Tooltip.Root>)}
          </Flex>}
        </Box>}
      </Box>
      <SpacesPage key={owner.slug} owner={owner} spaces={spaces.data} isLoading={spaces.isPending} error={spaces.error} onRetry={() => { void spaces.refetch() }} signedIn={Boolean(user)} canCreate={owner.ownerUserId === user?.id} />
    </PageContainer>
  )
}
