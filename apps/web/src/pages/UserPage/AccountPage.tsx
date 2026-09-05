import { Box, Heading, Portal, Text, Tooltip } from '@chakra-ui/react'
import { useParams } from 'react-router'
import { ActionButton, PageContainer, PageHeading, PageLink } from '../../components/ui/Primitives'
import { useMockAuth } from '../../context/mockAuth'
import { useSpaces } from '../../context/spaces'
import SpacesPage from '../SpacesPage/SpacesPage'
import { demoOrganization, demoUser, initialNamespaces, namespacePath, sameNamespace } from './namespaces'

export default function AccountPage() {
  const { account } = useParams()
  const { user } = useMockAuth()
  const { spaces } = useSpaces()
  const profiles = [...(user ? [user.namespace] : []), ...initialNamespaces, ...spaces.map(space => space.owner)]
  const owner = profiles.find(profile => profile.account === account)

  if (!owner) return <PageContainer textAlign="center"><PageHeading>Account not found</PageHeading><ActionButton asChild mt="20px"><PageLink to={namespacePath(user?.namespace ?? demoUser)}>Back to profile</PageLink></ActionButton></PageContainer>

  const { kind } = owner
  const count = spaces.filter(space => sameNamespace(space.owner, owner)).length
  return (
    <PageContainer maxW="1120px" display="grid" gridTemplateColumns={{ base: 'minmax(0, 1fr)', md: '220px minmax(0, 1fr)' }} gap={{ base: '28px', md: '48px' }} alignItems="start">
      <Box as="aside" p={{ base: '20px', md: '24px' }} border="1px solid color-mix(in srgb, var(--border) 55%, transparent)" borderRadius="8px" aria-label={kind === 'org' ? 'Organization information' : 'User information'}>
        <Box display="grid" placeItems="center" boxSize={{ base: '48px', md: '64px' }} mb={{ base: '12px', md: '20px' }} borderRadius={kind === 'org' ? '12px' : 'full'} bg="var(--surface)" color="var(--foreground)" fontSize={{ base: '22px', md: '26px' }} fontWeight="500" aria-hidden="true">{Array.from(owner.name)[0]?.toUpperCase()}</Box>
        <Heading as="h1" fontSize="21px" fontWeight="600" overflowWrap="anywhere">{owner.name}</Heading>
        <Text mt="4px" color="var(--muted)" fontSize="13px" overflowWrap="anywhere">@{owner.account}</Text>
        <Text mt="20px" fontSize="13px" lineHeight="1.8" color="var(--muted)">{owner.bio}</Text>
        <Text mt="20px" fontSize="11px" color="var(--muted)">{kind === 'org' ? 'Organization' : 'Personal account'} · {count} {count === 1 ? 'Space' : 'Spaces'}</Text>
        {kind === 'user' && (
          <Box mt="24px" pt="18px" borderTop="1px solid color-mix(in srgb, var(--border) 55%, transparent)">
            <Heading as="h2" mb="10px" fontSize="12px" fontWeight="500" color="var(--muted)">Organizations</Heading>
            <Tooltip.Root openDelay={200} closeDelay={0} positioning={{ placement: 'bottom' }}>
              <Tooltip.Trigger asChild>
                <PageLink to={namespacePath(demoOrganization)} aria-label={demoOrganization.name} display="inline-flex" alignItems="center" justifyContent="center" boxSize="32px" border="1px solid transparent" borderRadius="7px" bg="var(--surface)" color="var(--foreground)" fontSize="14px" fontWeight="600" _hover={{ borderColor: 'var(--border)' }}>
                  <Box as="span" aria-hidden="true">{Array.from(demoOrganization.name)[0]?.toUpperCase()}</Box>
                </PageLink>
              </Tooltip.Trigger>
              <Portal>
                <Tooltip.Positioner>
                  <Tooltip.Content bg="var(--foreground)" color="var(--background)" fontSize="xs" px="2.5" py="1.5" borderRadius="md">
                    {demoOrganization.name}
                  </Tooltip.Content>
                </Tooltip.Positioner>
              </Portal>
            </Tooltip.Root>
          </Box>
        )}
      </Box>
      <SpacesPage key={namespacePath(owner)} owner={owner} />
    </PageContainer>
  )
}
