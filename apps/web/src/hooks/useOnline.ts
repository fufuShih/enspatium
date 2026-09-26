import { useSyncExternalStore } from 'react'

function subscribe(notify: () => void) {
  window.addEventListener('online', notify)
  window.addEventListener('offline', notify)
  return () => { window.removeEventListener('online', notify); window.removeEventListener('offline', notify) }
}

// A hint for UI guards, not proof of server reachability. Requests still handle
// failures and permissions normally. No mutation is queued on reconnect.
export function useOnline() { return useSyncExternalStore(subscribe, () => navigator.onLine, () => true) }
