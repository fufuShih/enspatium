import { Suspense, useEffect } from 'react'
import { Box } from '@chakra-ui/react'
import { useQuery } from '@tanstack/react-query'
import { Route, Routes, useLocation, useParams } from 'react-router'
import { ActionButton, PageContainer, PageLink } from '../../components/ui/Primitives'
import AuthStatus from '../../components/AuthStatus'
import RequestState from '../../components/RequestState'
import { useAuth } from '../../context/auth'
import { apiStatus } from '../../context/session'
import type { AppPagePlugin } from './types'
import { getAppPlugin } from './registry'
import { appPath } from './paths'
import AppPwaRuntime from './AppPwaRuntime'

export default function AppPage() {
  const { appType, appId = '' } = useParams()
  const plugin = getAppPlugin(appType)
  return <Box as="main" minH="100dvh" bg="var(--background)" color="var(--foreground)">{plugin ? <><AppPwaRuntime key={`${plugin.type}:${appId}`} appType={plugin.type} appId={appId} /><AppContent key={plugin.type} plugin={plugin} /></> : <PageContainer><RequestState title="App not available" message="This app is not available on this site." /></PageContainer>}</Box>
}

function AppContent({ plugin }: { plugin: AppPagePlugin }) {
  const { appId = '' } = useParams()
  const location = useLocation()
  const { user, isLoading, error: sessionError } = useAuth()
  const query = useQuery({
    queryKey: ['app-instance', plugin.type, appId, user?.id ?? null],
    queryFn: ({ signal }) => plugin.integration.loadInstance(appId, signal),
    enabled: !isLoading && Boolean(appId), retry: false, gcTime: 0, staleTime: 0, refetchOnMount: 'always', refetchInterval: 30_000,
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
  const props = { instance: query.data, basePath: appPath(plugin.type, query.data.id) }
  return <Suspense fallback={<PageContainer><RequestState loading title="Loading app..." /></PageContainer>}>
    <Routes key={`${query.data.id}:${user?.id ?? 'anonymous'}`}>
      <Route index element={<plugin.view {...props} />} />
      {plugin.routes?.map(route => <Route key={route.path} path={route.path} element={<route.view {...props} />} />)}
      <Route path="*" element={<PageContainer><RequestState title="Page not found" message="This page does not exist in this app.">
        <ActionButton asChild mt="20px"><PageLink to={props.basePath}>Back to app</PageLink></ActionButton>
      </RequestState></PageContainer>} />
    </Routes>
  </Suspense>
}
