import { Box, Flex, Heading, Text, chakra } from '@chakra-ui/react'
import { useLocation, useParams } from 'react-router'
import { lazy, Suspense } from 'react'
import { getGetSpaceQueryKey, useGetSpace } from '../../api/generated/spaces'
import { ActionButton, PageContainer, PageHeading, PageLink } from '../../components/ui/Primitives'
import AuthStatus from '../../components/AuthStatus'
import RequestState from '../../components/RequestState'
import { useAuth } from '../../context/auth'
import { apiStatus } from '../../context/session'
import { namespacePath } from '../UserPage/namespaces'
import { spaceErrorMessage, spacePath } from './shared/spaceApi'
import { appPath, getAppPlugin } from '../AppPages/registry'
import ObjectFileList from './object/ObjectFileList'
import SpaceSettings from './settings/SpaceSettings'
import GitIcon from './git/GitIcon'

const GitBrowser = lazy(() => import('./git/GitBrowser'))

export default function SpacePage({ settings = false }: { settings?: boolean }) {
  const { account = '', spaceSlug = '', '*': childPath } = useParams()
  const location = useLocation()
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
      {status === 401 && <ActionButton asChild mt="20px"><PageLink to="/login" state={{ from: location.pathname + location.search }}>Sign in</PageLink></ActionButton>}
      <PageLink to={namespacePath({ account })} display="block" mt="20px" fontSize="13px">Back to profile</PageLink>
    </RequestState></PageContainer>
  }
  const space = query.data
  const isGit = space.type === 'git'
  const root = spacePath(account, space.slug)
  const previousCodePath = location.state?.spaceCodePath
  const codePath = settings && typeof previousCodePath === 'string' && (previousCodePath === root || previousCodePath.startsWith(root + '/')) && !previousCodePath.startsWith(root + '/settings') ? previousCodePath : root
  if (childPath && space.type !== 'git') return <PageContainer><RequestState title="Page not found" message="This Space page does not exist." /></PageContainer>
  const plugin = getAppPlugin(space.app)
  if (settings && !space.canManage) return <PageContainer><RequestState title="Access denied" message="Only a Space owner can manage settings."><PageLink to={spacePath(account, spaceSlug)} display="block" mt="20px">Back to Space</PageLink></RequestState></PageContainer>
  const details = [
    ['Owner', account],
    ['Type', plugin?.label ?? (space.type === 'git' ? 'Git repository' : 'Object storage')],
    ['Visibility', space.visibility === 'public' ? 'Public' : 'Private'],
    ['Created', new Date(space.createdAt).toLocaleString('en-US')],
    ['Updated', new Date(space.updatedAt).toLocaleString('en-US')],
  ]
  return (
    <PageContainer maxW={isGit ? '1120px' : '960px'}>
      <Box as="nav" aria-label="Breadcrumb" fontSize="13px" color="var(--muted)" overflowWrap="anywhere">
        <PageLink to={namespacePath({ account })}>{account}</PageLink><Text as="span" mx="10px">/</Text>{settings && !isGit ? <><PageLink to={root}>{space.slug}</PageLink><Text as="span" mx="10px">/</Text><Text as="span" aria-current="page">Settings</Text></> : <Text as="span" aria-current="page">{space.slug}</Text>}
      </Box>
      <Flex align={{ base: 'flex-start', sm: 'center' }} justify="space-between" direction={{ base: 'column', sm: 'row' }} gap="20px" mt="18px" mb="28px">
        <Flex align="center" gap="12px" wrap="wrap" minW="0">
          <PageHeading>{settings && !isGit ? 'Space settings' : space.name}</PageHeading>
          <Text fontSize="12px" color="var(--muted)" border="1px solid var(--border)" borderRadius="full" px="10px" py="3px">{space.visibility === 'public' ? 'Public' : 'Private'}</Text>
        </Flex>
        {!isGit && <Flex gap="8px" flexShrink="0" align="center">
          {!isGit && space.canManage && <ActionButton asChild minH="40px"><PageLink to={root + (settings ? '' : '/settings')}>{settings ? 'Back to Space' : 'Settings'}</PageLink></ActionButton>}
          {!settings && plugin && <ActionButton asChild minH="40px" bg="var(--foreground)" color="var(--background)" borderColor="var(--foreground)"><PageLink to={appPath(plugin.type, space.id)} target="_blank" rel="noopener noreferrer" title={`Open ${plugin.label} in a new tab`} aria-label="Open app (opens in a new tab)" _hover={{ color: 'var(--background)' }}>Open app<Text as="span" aria-hidden="true">↗</Text></PageLink></ActionButton>}
        </Flex>}
      </Flex>
      {isGit && <Flex as="nav" aria-label="Space navigation" gap="28px" borderBottom="1px solid var(--border)" mb="28px" fontSize="14px">
        <PageLink to={codePath} display="flex" alignItems="center" gap="8px" pb="12px" borderBottom={!settings ? '2px solid var(--foreground)' : '2px solid transparent'} color={!settings ? 'var(--foreground)' : 'var(--muted)'} fontWeight={!settings ? '500' : '400'} aria-current={!settings ? 'page' : undefined}><GitIcon name="code" />Code</PageLink>
        {space.canManage && <PageLink to={root + '/settings'} state={{ spaceCodePath: settings ? codePath : location.pathname + location.search }} ml="auto" display="flex" alignItems="center" gap="8px" pb="12px" borderBottom={settings ? '2px solid var(--foreground)' : '2px solid transparent'} color={settings ? 'var(--foreground)' : 'var(--muted)'} fontWeight={settings ? '500' : '400'} aria-current={settings ? 'page' : undefined}><GitIcon name="settings" />Settings</PageLink>}
      </Flex>}
      {settings ? <>{isGit && <Heading as="h2" fontSize="20px" fontWeight="500" mb="24px">Space settings</Heading>}<SpaceSettings key={`${space.id}:${user?.id}`} account={account} space={space} /></> : <>
      {space.type === 'object' && <ObjectFileList key={`${space.id}:${user?.id ?? 'anonymous'}`} account={account} slug={space.slug} />}
      {space.type === 'git' && <Suspense fallback={<RequestState loading title="Loading repository..." />}><GitBrowser key={`${space.id}:${user?.id ?? 'anonymous'}`} account={account} slug={space.slug} /></Suspense>}
      <Box as="section" aria-label="Space details" mt="32px" border="1px solid color-mix(in srgb, var(--border) 60%, transparent)" borderRadius="8px" p={{ base: '20px', md: '28px' }}>
        <chakra.details open={space.type !== 'git' ? true : undefined}>
        <chakra.summary display={space.type === 'git' ? 'list-item' : 'none'} cursor="pointer" fontSize="13px" color="var(--muted)">Repository details</chakra.summary>
        <Box as="dl" display="grid" gridTemplateColumns={{ base: '1fr', sm: '120px minmax(0, 1fr)' }} columnGap="24px" rowGap="12px" fontSize="13px" m="0" mt={space.type === 'git' ? '20px' : '0'}>
          {details.map(([label, value]) => <Box key={label} display="contents"><Box as="dt" color="var(--muted)">{label}</Box><Box as="dd" m="0" overflowWrap="anywhere" mb={{ base: '8px', sm: '0' }}>{value}</Box></Box>)}
        </Box>
        </chakra.details>
      </Box>
      </>}
    </PageContainer>
  )
}
