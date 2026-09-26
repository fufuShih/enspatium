import { useEffect } from 'react'
import { useTheme } from 'next-themes'
import { useGetAppPwaEntry } from '../../api/generated/apps'
import { apiStatus } from '../../context/session'
import { appPath } from './paths'
import { clearPwaMetadata, registerAppWorker, setPwaMetadata, unregisterAppWorker } from './pwaRuntime'

export default function AppPwaRuntime({ appType, appId }: { appType: string; appId: string }) {
  const { resolvedTheme } = useTheme()
  const query = useGetAppPwaEntry(appType, appId, { query: { retry: false, gcTime: 0, staleTime: 0,
    refetchOnMount: 'always', refetchInterval: 30_000 } })
  const missing = apiStatus(query.error) === 404
  useEffect(() => () => clearPwaMetadata(), [])
  useEffect(() => {
    if (missing) clearPwaMetadata()
    else if (query.data) setPwaMetadata(query.data, resolvedTheme === 'dark')
  }, [query.data, missing, resolvedTheme])
  const enabled = query.data?.enabled
  useEffect(() => {
    if (!window.isSecureContext || !('serviceWorker' in navigator)) return
    const base = appPath(appType, appId)
    // Failure to register must not prevent using the ordinary online App.
    if (enabled === false || missing) void unregisterAppWorker(navigator.serviceWorker, location.origin, base).catch(() => {})
    else if (enabled) void registerAppWorker(navigator.serviceWorker, base).catch(() => {})
  }, [appType, appId, enabled, missing])
  return null
}
