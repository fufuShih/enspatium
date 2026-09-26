import { Box, Dialog, Flex, Portal, Text, chakra } from '@chakra-ui/react'
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { GetSpace200, ListSpaceApps200AppsItem } from '../../../api/generated/api.schemas'
import { getListAppsQueryKey, useListApps } from '../../../api/generated/apps'
import { createSpaceApp, deleteSpaceApp, updateSpaceApp } from '../../../api/generated/space-apps'
import { ActionButton, SelectInput, TextInput } from '../../../components/ui/Primitives'
import { useAuth } from '../../../context/auth'
import { apiStatus } from '../../../context/session'
import { compatibleSpaceApps, refreshSpaceApps, spaceAppError } from './spaceAppsApi'

export type SpaceAppAction = { kind: 'create' } | { kind: 'rename' | 'remove'; instance: ListSpaceApps200AppsItem }

export default function SpaceAppDialog({ account, space, action, onClose, onSaved, onDenied }: {
  account: string; space: GetSpace200; action: SpaceAppAction
  onClose: () => void; onSaved: (message: string) => void; onDenied: (message: string) => void
}) {
  const { user } = useAuth()
  const client = useQueryClient()
  const [name, setName] = useState(action.kind === 'create' ? space.name : action.instance.name)
  const [selectedType, setSelectedType] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const operation = useRef<AbortController | null>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const registry = useListApps({ query: { enabled: action.kind === 'create' && Boolean(user), retry: false,
    queryKey: [...getListAppsQueryKey(), user?.id ?? null] } })
  const available = compatibleSpaceApps(registry.isError ? [] : registry.data ?? [], space.type)
  const type = available.find(app => app.type === selectedType)?.type ?? available[0]?.type ?? ''
  const removing = action.kind === 'remove'
  const title = removing ? 'Remove app?' : action.kind === 'create' ? 'Create app' : 'Rename app'
  useEffect(() => () => { operation.current?.abort() }, [])

  async function submit() {
    if (operation.current || (!removing && !name.trim()) || (action.kind === 'create' && !type)) return
    const controller = new AbortController()
    operation.current = controller; setBusy(true); setError('')
    try {
      let instance
      if (action.kind === 'create') instance = await createSpaceApp(account, space.slug, { appType: type, name: name.trim() }, { signal: controller.signal })
      else if (action.kind === 'rename') instance = await updateSpaceApp(account, space.slug, action.instance.id, { name: name.trim() }, { signal: controller.signal })
      else {
        await deleteSpaceApp(account, space.slug, action.instance.id, { signal: controller.signal })
        instance = action.instance
      }
      await refreshSpaceApps(client, account, space.slug, instance)
      if (!controller.signal.aborted) onSaved(removing ? 'App removed. Files and versions were kept.' : action.kind === 'create' ? 'App created.' : 'App renamed. Its link stays the same.')
    } catch (failure) {
      if (!controller.signal.aborted) {
        const message = spaceAppError(failure)
        setError(message)
        if ([401, 403, 404].includes(apiStatus(failure) ?? 0)) {
          onDenied(message)
          if (apiStatus(failure) === 401) void client.invalidateQueries({ queryKey: ['session'] })
          void refreshSpaceApps(client, account, space.slug)
        }
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false)
      operation.current = null
    }
  }

  return <Dialog.Root open role={removing ? 'alertdialog' : 'dialog'} onOpenChange={event => { if (!event.open && !busy) onClose() }} placement="center" initialFocusEl={() => removing ? cancelButton.current : nameInput.current} closeOnEscape={!busy} closeOnInteractOutside={!busy}>
    <Portal><Dialog.Backdrop /><Dialog.Positioner p="20px"><Dialog.Content w="full" maxW="460px" bg="var(--background)" color="var(--foreground)" border="1px solid var(--border)" borderRadius="12px">
      <Box asChild><form onSubmit={event => { event.preventDefault(); void submit() }}>
        <Dialog.Header><Dialog.Title fontSize="20px">{title}</Dialog.Title></Dialog.Header>
        <Dialog.Body>
          {removing ? <>
            <Text fontSize="14px" fontWeight="500" mb="12px" overflowWrap="anywhere">{action.instance.name}</Text>
            <Dialog.Description fontSize="13px" lineHeight="1.8">Only this app's entry and settings will be removed. Files, versions, permissions and other apps are kept. Existing links to this app will stop working. This cannot be undone.</Dialog.Description>
          </> : <>
            <Dialog.Description fontSize="13px" color="var(--muted)" lineHeight="1.8" mb="20px">{action.kind === 'create' ? 'Apps share this Space’s files, visibility and permissions. You can create more than one app of the same type.' : 'The app name can differ from the Space name. Its URL and content stay the same.'}</Dialog.Description>
            {action.kind === 'create' && <Box mb="18px">
              <chakra.label htmlFor="app-type" display="block" fontSize="13px" mb="8px">App type</chakra.label>
              <SelectInput id="app-type" value={type} disabled={busy || registry.isPending || registry.isError || !available.length} onChange={event => { setSelectedType(event.target.value); setError('') }}>
                {!available.length && <option value="">{registry.isPending ? 'Loading app types…' : 'No compatible apps available'}</option>}
                {available.map(app => <option key={app.type} value={app.type}>{app.name}</option>)}
              </SelectInput>
              {registry.isError && <Flex gap="8px" mt="8px" align="center"><Text role="alert" fontSize="12px">Unable to load app types.</Text><ActionButton type="button" onClick={() => { void registry.refetch() }}>Retry</ActionButton></Flex>}
            </Box>}
            <chakra.label htmlFor="app-name" display="block" fontSize="13px" mb="8px">App name</chakra.label>
            <TextInput id="app-name" ref={nameInput} required maxLength={100} value={name} disabled={busy} onChange={event => { setName(event.target.value); setError('') }} />
          </>}
          {error && <Text role="alert" color="fg.error" mt="16px" fontSize="13px">{error}</Text>}
        </Dialog.Body>
        <Dialog.Footer>
          <ActionButton asChild><chakra.button ref={cancelButton} type="button" disabled={busy} onClick={onClose}>Cancel</chakra.button></ActionButton>
          <ActionButton type="submit" loading={busy} color={removing ? 'fg.error' : undefined} disabled={busy || (!removing && !name.trim()) || (action.kind === 'create' && !type) || (action.kind === 'rename' && name.trim() === action.instance.name)}>{removing ? 'Remove app' : action.kind === 'create' ? 'Create app' : 'Save name'}</ActionButton>
        </Dialog.Footer>
      </form></Box>
    </Dialog.Content></Dialog.Positioner></Portal>
  </Dialog.Root>
}
