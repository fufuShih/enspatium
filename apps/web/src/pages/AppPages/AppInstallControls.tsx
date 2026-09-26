import { Dialog, Flex, Portal, Text } from '@chakra-ui/react'
import { useEffect, useRef, useState } from 'react'
import { ActionButton } from '../../components/ui/Primitives'
import { useOnline } from '../../hooks/useOnline'

interface InstallPrompt extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type OfflineStatus = 'preparing' | 'ready' | 'unavailable' | 'development'

export default function AppInstallControls({ enabled, base, offlineStatus }: { enabled: boolean; base: string; offlineStatus: OfflineStatus }) {
  const online = useOnline()
  const pending = useRef<InstallPrompt | null>(null)
  const [available, setAvailable] = useState(false)
  const [standalone, setStandalone] = useState(false)
  const [installed, setInstalled] = useState(false)
  const [help, setHelp] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    const mode = window.matchMedia('(display-mode: standalone), (display-mode: minimal-ui), (display-mode: window-controls-overlay)')
    const changed = () => setStandalone(mode.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)
    changed(); mode.addEventListener('change', changed)
    const capture = (event: Event) => {
      // Capture early (before the metadata query resolves), but never reuse an
      // event for a different App or a manifest left over from SPA navigation.
      const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
      if (manifest?.href !== new URL(base + 'manifest.webmanifest', location.origin).href) return
      event.preventDefault()
      pending.current = event as InstallPrompt; setAvailable(true); setMessage('')
    }
    const completed = () => { pending.current = null; setAvailable(false); setInstalled(true); setMessage('') }
    window.addEventListener('beforeinstallprompt', capture)
    window.addEventListener('appinstalled', completed)
    return () => {
      pending.current = null
      mode.removeEventListener('change', changed)
      window.removeEventListener('beforeinstallprompt', capture)
      window.removeEventListener('appinstalled', completed)
    }
  }, [base])
  async function install() {
    const event = pending.current
    if (!enabled || !online || busy || !event) return
    pending.current = null; setAvailable(false); setBusy(true); setMessage('')
    try {
      // Must happen directly in the user's click, without an awaited API call.
      await event.prompt()
      const choice = await event.userChoice
      setMessage(choice.outcome === 'accepted' ? 'Installation requested. Follow the browser to finish.' : 'Installation dismissed. You can continue in the browser.')
    } catch { setMessage('The install prompt is unavailable. See installation help for other options.') }
    finally { setBusy(false) }
  }
  return <>
    {(!online || enabled) && <Flex as="section" aria-label="App installation and connection" align="center" justify="flex-end" wrap="wrap" gap="10px" px={{ base: '20px', md: '28px' }} py="10px" borderBottom="1px solid var(--border)" bg="var(--surface)">
      {!online && <Text role="status" flex="1" fontSize="13px">You are offline. Content and changes require a connection. Unsaved drafts remain only in this tab.</Text>}
      {enabled && <>
        {message && !installed && <Text role="status" fontSize="12px">{message}</Text>}
        {(standalone || installed) ? <Text fontSize="12px" color="var(--muted)">{standalone ? 'App mode' : 'App installed'}</Text>
          : available && <ActionButton onClick={() => { void install() }} disabled={!online || busy} loading={busy}>Install app</ActionButton>}
        <ActionButton onClick={() => setHelp(true)}>Installation help</ActionButton>
      </>}
    </Flex>}
    <Dialog.Root open={enabled && help} onOpenChange={event => setHelp(event.open)} placement="center" scrollBehavior="inside">
      <Portal><Dialog.Backdrop /><Dialog.Positioner p="20px"><Dialog.Content maxW="480px" bg="var(--background)" color="var(--foreground)" border="1px solid var(--border)" borderRadius="12px">
        <Dialog.Header><Dialog.Title>Install this app</Dialog.Title></Dialog.Header>
        <Dialog.Body>
          <Dialog.Description fontSize="13px" lineHeight="1.8">Installation is optional. This app keeps its own entry and icon, and uses the same Space permissions and sign-in.</Dialog.Description>
          {!window.isSecureContext && <Text role="alert" mt="16px" fontSize="13px">Open this site over HTTPS to enable installation and offline setup.</Text>}
          <Text mt="16px" fontSize="13px" lineHeight="1.8">Chrome or Edge: use Install app when offered, or look for an install option in the address bar or browser menu.</Text>
          <Text mt="12px" fontSize="13px" lineHeight="1.8">iPhone or iPad: open this page in Safari, choose Share, then Add to Home Screen. Enable Open as Web App if shown.</Text>
          <Text mt="12px" fontSize="13px" lineHeight="1.8">Other browsers: look for Add to Home Screen or Add to Dock. If installation is unavailable, bookmark this page and keep using it in the browser.</Text>
          <Text mt="18px" fontSize="13px" fontWeight="600" role="status">{offlineStatus === 'ready' ? 'Offline page ready' : offlineStatus === 'preparing' ? 'Preparing offline page…' : offlineStatus === 'development' ? 'Offline caching is disabled in development' : 'Offline page is not ready'}</Text>
          <Text mt="8px" fontSize="13px" lineHeight="1.8">Only a generic offline page is saved, not notes, books, media or account data. Reconnect to read or make changes. Nothing is saved automatically when the connection returns.</Text>
          {offlineStatus === 'unavailable' && <Text mt="8px" fontSize="13px">Offline setup may be blocked by browser storage settings or an unavailable server. Reopen the app online to retry; online use is unaffected.</Text>}
          <Text mt="12px" fontSize="12px" color="var(--muted)">Browser menus and support vary. An installed copy may still ask you to sign in. Removing it from your device does not delete Space files.</Text>
        </Dialog.Body>
        <Dialog.Footer><ActionButton onClick={() => setHelp(false)}>Close</ActionButton></Dialog.Footer>
      </Dialog.Content></Dialog.Positioner></Portal>
    </Dialog.Root>
  </>
}
