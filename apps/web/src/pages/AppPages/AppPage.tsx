import { Suspense, useEffect } from 'react'
import { Box } from '@chakra-ui/react'
import { useQuery } from '@tanstack/react-query'
import { useLocation, useParams } from 'react-router'
import { ActionButton, PageContainer, PageLink } from '../../components/ui/Primitives'
import AuthStatus from '../../components/AuthStatus'
import RequestState from '../../components/RequestState'
import { useAuth } from '../../context/auth'
import { apiStatus } from '../../context/session'
import type { AppPagePlugin } from './types'
import { getAppPlugin } from './registry'

export default function AppPage() {
  const { appType } = useParams()
  const plugin = getAppPlugin(appType)
  return <Box as="main" minH="100dvh" bg="var(--background)" color="var(--foreground)">{plugin ? <AppContent key={plugin.type} plugin={plugin} /> : <PageContainer><RequestState title="App not available" message="This app is not available on this site." /></PageContainer>}</Box>
}

function AppContent({ plugin }: { plugin: AppPagePlugin }) {
  const { spaceId = '' } = useParams()
  const location = useLocation()
  const { user, isLoading, error: sessionError } = useAuth()
  const query = useQuery({
    queryKey: ['app-space', plugin.type, spaceId, user?.id ?? null],
    queryFn: ({ signal }) => plugin.integration.loadSpace(spaceId, signal),
    enabled: !isLoading && Boolean(spaceId), retry: false,
  })
  const name = query.data?.name
  useEffect(() => {
    const previous = document.title
    document.title = name ? `${name} · ${plugin.label}` : plugin.label
    return () => { document.title = previous }
  }, [name, plugin.label])
  if (isLoading || (sessionError && !user)) return <PageContainer><AuthStatus /></PageContainer>
  if (query.isPending) return <PageContainer><RequestState loading title="Loading app..." /></PageContainer>
  if (query.isError) {
    const responseStatus = apiStatus(query.error)
    const status = responseStatus === 400 ? 404 : responseStatus
    return <PageContainer><RequestState title={status === 401 ? 'Sign in to open this app' : status === 403 ? 'Access denied' : status === 404 ? 'App not found' : 'Unable to load app'}
      message={status === 401 ? 'This Space is private.' : status === 403 ? 'You do not have access to this Space.' : status === 404 ? 'This app is no longer available.' : 'Please try again.'}
      onRetry={status === 401 ? undefined : () => { void query.refetch() }}>
      {status === 401 && <ActionButton asChild mt="20px"><PageLink to="/login" state={{ from: location.pathname + location.search }}>Sign in</PageLink></ActionButton>}
    </RequestState></PageContainer>
  }
  return <Suspense fallback={<PageContainer><RequestState loading title="Loading app..." /></PageContainer>}><plugin.view key={`${query.data.id}:${user?.id ?? 'anonymous'}`} space={query.data} /></Suspense>
}
