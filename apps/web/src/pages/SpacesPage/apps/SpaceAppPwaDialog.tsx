import { Box, Dialog, Flex, Portal, Text, chakra } from '@chakra-ui/react'
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { GetSpace200, ListSpaceApps200AppsItem } from '../../../api/generated/api.schemas'
import { updateSpaceAppPwa } from '../../../api/generated/space-apps'
import { getObjectHead } from '../../../api/generated/objects'
import { ActionButton, SelectInput, TextInput } from '../../../components/ui/Primitives'
import { apiStatus } from '../../../context/session'
import { refreshSpaceApps, spaceAppError } from './spaceAppsApi'
import { appPath } from '../../AppPages/paths'

export default function SpaceAppPwaDialog({ account, space, instance, onClose, onSaved, onDenied }: {
  account: string; space: GetSpace200; instance: ListSpaceApps200AppsItem
  onClose: () => void; onSaved: (message: string) => void; onDenied: (message: string) => void
}) {
  const client = useQueryClient()
  const [name, setName] = useState(instance.name)
  const [enabled, setEnabled] = useState(instance.pwa.enabled)
  const [color, setColor] = useState(instance.pwa.themeColor ?? '')
  const [iconMode, setIconMode] = useState(instance.pwa.iconObjectId ? 'current' : 'builtin')
  const [iconKey, setIconKey] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const operation = useRef<AbortController | null>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const valid = Boolean(name.trim()) && (!color.trim() || /^#[0-9a-f]{6}$/i.test(color.trim())) && (iconMode !== 'file' || Boolean(iconKey.trim())) && (!enabled || acknowledged)
  useEffect(() => () => operation.current?.abort(), [])

  async function save() {
    if (operation.current || !valid) return
    const controller = new AbortController()
    operation.current = controller; setBusy(true); setError('')
    let resolvingIcon = false
    try {
      let iconObjectId = iconMode === 'current' ? instance.pwa.iconObjectId : null
      if (iconMode === 'file') {
        resolvingIcon = true
        const icon = await getObjectHead(account, space.slug, { key: iconKey.trim() }, { signal: controller.signal })
        if (!icon || icon.isDeleted) throw Object.assign(new Error('Icon file not found'), { status: 404 })
        iconObjectId = icon.id
        resolvingIcon = false
      }
      const updated = await updateSpaceAppPwa(account, space.slug, instance.id, { name: name.trim(),
        pwa: { enabled, iconObjectId, themeColor: color.trim() || null, offlinePolicy: 'shell' },
        publishAcknowledged: acknowledged, refreshIcon: iconMode === 'file',
      }, { signal: controller.signal })
      await refreshSpaceApps(client, account, space.slug, updated)
      if (!controller.signal.aborted) onSaved(enabled ? 'PWA settings saved. Installation metadata is public; content still requires Space access.' : 'PWA disabled. The app URL and files are kept. Already installed copies are not removed remotely.')
    } catch (failure) {
      if (!controller.signal.aborted) {
        const status = apiStatus(failure)
        const message = resolvingIcon && status === 404 ? 'Icon file not found. Enter the exact path of an active file in this Space.'
          : status === 400 ? 'Check the name, color and icon. Use a single-frame PNG, JPEG or WebP, at most 2 MiB and 2048 × 2048 pixels.'
            : status === 429 || status === 503 ? 'PWA settings are busy. Please try again shortly.' : spaceAppError(failure)
        setError(message)
        if (status === 401 || status === 403 || (status === 404 && !resolvingIcon)) {
          onDenied(message)
          if (status === 401) void client.invalidateQueries({ queryKey: ['session'] })
          void refreshSpaceApps(client, account, space.slug)
        }
      }
    } finally { if (!controller.signal.aborted) setBusy(false); operation.current = null }
  }

  return <Dialog.Root open onOpenChange={event => { if (!event.open && !busy) onClose() }} placement="center" scrollBehavior="inside" initialFocusEl={() => nameInput.current} closeOnEscape={!busy} closeOnInteractOutside={!busy}>
    <Portal><Dialog.Backdrop /><Dialog.Positioner p="20px"><Dialog.Content w="full" maxW="520px" bg="var(--background)" color="var(--foreground)" border="1px solid var(--border)" borderRadius="12px">
      <Dialog.Header><Dialog.Title>PWA settings</Dialog.Title></Dialog.Header>
      <Dialog.Body>
        <Dialog.Description fontSize="13px" lineHeight="1.8" mb="18px">Give this app an independent installation identity. Its URL, Space content and permissions stay the same. HTTPS is required, except on localhost.</Dialog.Description>
        <form id="app-pwa-settings" onSubmit={event => { event.preventDefault(); void save() }}>
          <chakra.fieldset disabled={busy} border="0" p="0" m="0" minW="0">
            <Flex as="label" gap="10px" align="center" fontSize="14px" mb="18px"><chakra.input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />Enable PWA</Flex>
            <chakra.label htmlFor="pwa-name" display="block" fontSize="13px" mb="8px">App and installation name</chakra.label>
            <TextInput id="pwa-name" ref={nameInput} required maxLength={100} value={name} onChange={event => setName(event.target.value)} />
            <chakra.label htmlFor="pwa-icon" display="block" fontSize="13px" mt="18px" mb="8px">Installation icon</chakra.label>
            <SelectInput id="pwa-icon" value={iconMode} onChange={event => setIconMode(event.target.value)}>
              <option value="builtin">Built-in app icon</option>
              {instance.pwa.iconObjectId && <option value="current">Keep current published icon</option>}
              <option value="file">Use a file from this Space</option>
            </SelectInput>
            {iconMode === 'file' && <Box mt="12px"><chakra.label htmlFor="pwa-icon-key" display="block" fontSize="13px" mb="8px">Icon file path</chakra.label><TextInput id="pwa-icon-key" required value={iconKey} placeholder="Icons/logo.png" onChange={event => setIconKey(event.target.value)} /><Text fontSize="12px" color="var(--muted)" mt="8px">Upload it in Files first. Single-frame PNG, JPEG or WebP; up to 2 MiB and 2048 × 2048 pixels. A sanitized PNG copy is published, without the original file URL or metadata. Source changes do not update this copy; select the file again to republish it.</Text></Box>}
            {instance.pwa.enabled && iconMode !== 'file' && <chakra.img mt="12px" w="48px" h="48px" src={appPath(instance.appType, instance.id) + 'icon-192.png?v=' + encodeURIComponent(instance.updatedAt)} alt="Currently published installation icon" />}
            <chakra.label htmlFor="pwa-color" display="block" fontSize="13px" mt="18px" mb="8px">Theme color</chakra.label>
            <TextInput id="pwa-color" value={color} placeholder="Platform theme" maxLength={7} pattern="#[0-9a-fA-F]{6}|" onChange={event => setColor(event.target.value)} />
            <Text fontSize="12px" color="var(--muted)" mt="8px">Optional #RRGGBB. This changes installation chrome, not the app's light/dark theme.</Text>
            <Text fontSize="12px" color="var(--muted)" mt="18px">The app offers installation help and saves only a generic offline page. Notes, books, media and account data require a connection; changes are never queued for later.</Text>
            {enabled && <Flex as="label" align="flex-start" gap="10px" mt="18px" fontSize="13px" lineHeight="1.8"><chakra.input type="checkbox" required mt="5px" flexShrink="0" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I understand that the app name, installation icon and theme color will be public, even for a private Space. Do not include sensitive information.</Flex>}
            {!enabled && <Text fontSize="12px" color="var(--muted)" mt="18px">Disabling stops new installation metadata requests. It cannot remotely remove installed copies or information already downloaded.</Text>}
          </chakra.fieldset>
        </form>
        {error && <Text role="alert" color="fg.error" fontSize="13px" mt="16px">{error}</Text>}
      </Dialog.Body>
      <Dialog.Footer><ActionButton disabled={busy} onClick={onClose}>Cancel</ActionButton><ActionButton form="app-pwa-settings" type="submit" disabled={busy || !valid} loading={busy}>Save PWA settings</ActionButton></Dialog.Footer>
    </Dialog.Content></Dialog.Positioner></Portal>
  </Dialog.Root>
}
