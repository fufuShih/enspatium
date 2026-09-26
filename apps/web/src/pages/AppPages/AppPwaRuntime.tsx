import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { useGetAppPwaEntry } from '../../api/generated/apps'
import { apiStatus } from '../../context/session'
import { appPath } from './paths'
import { appWorkerStatus, clearAppCaches, clearPwaMetadata, registerAppWorker, setPwaMetadata, unregisterAppWorker } from './pwaRuntime'
import AppInstallControls, { type OfflineStatus } from './AppInstallControls'

export default function AppPwaRuntime({ appType, appId }: { appType: string; appId: string }) {
  const { resolvedTheme } = useTheme()
  const query = useGetAppPwaEntry(appType, appId, { query: { retry: false, gcTime: 0, staleTime: 0,
    refetchOnMount: 'always', refetchInterval: 30_000 } })
  const missing = apiStatus(query.error) === 404
  const [offlineStatus, setOfflineStatus] = useState<OfflineStatus>(() => window.isSecureContext && 'serviceWorker' in navigator ? 'preparing' : 'unavailable')
  useEffect(() => () => clearPwaMetadata(), [])
  useEffect(() => {
    if (missing) clearPwaMetadata()
    else if (query.data) setPwaMetadata(query.data, resolvedTheme === 'dark')
  }, [query.data, missing, resolvedTheme])
  const enabled = query.data?.enabled
  useEffect(() => {
    if (!window.isSecureContext || !('serviceWorker' in navigator)) return
    const base = appPath(appType, appId)
    let cancelled = false
    let registration: ServiceWorkerRegistration | undefined
    let check = 0
    const watched = new Map<ServiceWorker, () => void>()
    const stateChanged = () => {
      const worker = registration?.active
      const current = ++check
      if (worker) void appWorkerStatus(worker).then(async status => {
        const stale = () => cancelled || current !== check || registration?.active !== worker
        if (stale()) return
        if (!status.ready && !status.development && navigator.onLine) status = await appWorkerStatus(worker, true)
        if (!stale()) setOfflineStatus(status.development ? 'development' : status.ready ? 'ready' : 'unavailable')
      })
    }
    const update = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        stateChanged()
        void registration?.update().catch(() => {})
      }
    }
    const installingChanged = () => {
      const worker = registration?.installing
      if (worker && !watched.has(worker)) {
        const changed = () => {
          if (!cancelled && worker.state === 'redundant' && !registration?.active) setOfflineStatus('unavailable')
          stateChanged()
        }
        watched.set(worker, changed); worker.addEventListener('statechange', changed)
      }
      stateChanged()
    }
    // Failure to register must not prevent using the ordinary online App.
    if (enabled === false || missing) {
      void unregisterAppWorker(navigator.serviceWorker, location.origin, base).catch(() => {}).then(() => {
        if ('caches' in window) return clearAppCaches(caches, appId).catch(() => {})
      })
    } else if (enabled) {
      void registerAppWorker(navigator.serviceWorker, base).then(value => {
        if (cancelled) return
        registration = value
        registration.addEventListener('updatefound', installingChanged)
        installingChanged()
      }).catch(() => { if (!cancelled) setOfflineStatus('unavailable') })
      navigator.serviceWorker.addEventListener('controllerchange', stateChanged)
      window.addEventListener('online', update)
      document.addEventListener('visibilitychange', update)
    }
    return () => {
      cancelled = true
      registration?.removeEventListener('updatefound', installingChanged)
      watched.forEach((changed, worker) => worker.removeEventListener('statechange', changed))
      navigator.serviceWorker.removeEventListener('controllerchange', stateChanged)
      window.removeEventListener('online', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [appType, appId, enabled, missing])
  // A confirmed disable destroys deferred prompts; initial loading keeps the
  // same control so a browser event arriving before the query is not lost.
  return <AppInstallControls key={enabled === false || missing ? 'disabled' : 'enabled'} enabled={enabled === true && !missing} base={appPath(appType, appId)} offlineStatus={offlineStatus} />
}
