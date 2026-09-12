import { Box, Dialog, Menu, Portal, Text, chakra } from '@chakra-ui/react'
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { MoveObject200 } from '../../../../api/generated/api.schemas'
import { moveObject } from '../../../../api/generated/objects'
import { ActionButton, TextInput } from '../../../../components/ui/Primitives'
import { apiCode, apiStatus } from '../../../../context/session'
import { fileErrorMessage, refreshObjectLists } from '../../../SpacesPage/object/objectFileApi'
import { deleteSelectedObject, type DeleteTarget } from '../../../SpacesPage/object/objectDeletion'
import { objectParent } from '../../../SpacesPage/object/objectMoveApi'
import type { AppSpace } from '../../types'
import { noteMoveKey } from './noteManagement'

type Action = 'rename' | 'move' | 'delete'
type Props = {
  space: AppSpace; file: DeleteTarget; dirty: boolean; disabled: boolean
  onBusy: (busy: boolean) => void; onMoved: (file: MoveObject200) => void; onDeleted: () => void
}

export default function NoteActions({ space, file, dirty, disabled, onBusy, onMoved, onDeleted }: Props) {
  const client = useQueryClient()
  const [action, setAction] = useState<Action | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [needsReload, setNeedsReload] = useState(false)
  const operation = useRef<AbortController | null>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => () => { operation.current?.abort(); onBusy(false) }, [onBusy])
  const target = action && action !== 'delete' ? noteMoveKey(file.key, action, value) : null

  function open(next: Action) {
    if (disabled || dirty) return
    setAction(next); setError(''); setNeedsReload(false)
    setValue(next === 'rename' ? file.key.split('/').at(-1)!.replace(/\.(md|markdown)$/i, '') : objectParent(file.key))
  }
  async function submit() {
    if (!action || operation.current || disabled || dirty || needsReload) return
    if (action !== 'delete' && (!target || target === file.key)) return
    const controller = new AbortController()
    operation.current = controller; setBusy(true); onBusy(true); setError('')
    try {
      if (action === 'delete') {
        await deleteSelectedObject(space.account, space.slug, file, controller.signal)
      } else {
        const moved = await moveObject(space.account, space.slug, { objectId: file.id, key: file.key, newKey: target!, expectedVersion: file.versionId }, { signal: controller.signal })
        if (!controller.signal.aborted) onMoved(moved)
      }
      await refreshObjectLists(client, space.account, space.slug).catch(() => {})
      if (!controller.signal.aborted) {
        setAction(null)
        if (action === 'delete') onDeleted()
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        const collision = apiCode(failure) === 'OBJECT_KEY_CONFLICT'
        const changed = !collision && [404, 409].includes(apiStatus(failure) ?? 0)
        setNeedsReload(changed)
        setError(collision ? 'This name is used by a file, folder or deleted note. Choose another destination.'
          : changed ? 'This note changed or moved elsewhere. Cancel and reload the note before trying again.'
          : fileErrorMessage(failure, action === 'delete' ? 'delete' : 'move'))
      }
    } finally {
      if (!controller.signal.aborted) { setBusy(false); onBusy(false) }
      operation.current = null
    }
  }

  return <>
    <Menu.Root positioning={{ placement: 'bottom-end' }}>
      <Menu.Trigger asChild><ActionButton aria-label="Note actions" disabled={disabled || dirty} title={dirty ? 'Save your changes before managing this note.' : 'Note actions'} px="12px">•••</ActionButton></Menu.Trigger>
      <Portal><Menu.Positioner><Menu.Content bg="var(--background)" color="var(--foreground)" border="1px solid var(--border)" minW="170px" css={{ '& [role=menuitem]': { cursor: 'pointer' } }}>
        <Menu.Item value="rename" onClick={() => open('rename')}>Rename</Menu.Item>
        <Menu.Item value="move" onClick={() => open('move')}>Move</Menu.Item>
        <Menu.Separator borderColor="var(--border)" />
        <Menu.Item value="delete" color="fg.error" onClick={() => open('delete')}>Delete note</Menu.Item>
      </Menu.Content></Menu.Positioner></Portal>
    </Menu.Root>
    <Dialog.Root open={action !== null} onOpenChange={event => { if (!event.open && !busy) setAction(null) }} placement="center" initialFocusEl={() => action === 'delete' ? cancelButton.current : input.current} closeOnEscape={!busy} closeOnInteractOutside={!busy}>
      <Portal><Dialog.Backdrop /><Dialog.Positioner p="20px"><Dialog.Content bg="var(--background)" color="var(--foreground)" border="1px solid var(--border)" borderRadius="12px" maxW="440px">
        <Box asChild><form onSubmit={event => { event.preventDefault(); void submit() }}>
          <Dialog.Header><Dialog.Title fontSize="18px">{action === 'delete' ? 'Delete this note?' : action === 'rename' ? 'Rename note' : 'Move note'}</Dialog.Title></Dialog.Header>
          <Dialog.Body>
            <Text fontSize="12px" color="var(--muted)" mb="16px" overflowWrap="anywhere">{file.key}</Text>
            {action === 'delete' ? <Dialog.Description fontSize="13px" lineHeight="1.8">Move this note to Deleted files? You can restore it from Files until retention cleanup removes its content.</Dialog.Description> : <>
              <chakra.label htmlFor="note-destination" fontSize="13px">{action === 'rename' ? 'Note name' : 'Destination folder'}</chakra.label>
              <TextInput id="note-destination" ref={input} mt="8px" value={value} disabled={busy || needsReload} maxLength={1024} onChange={event => { setValue(event.target.value); setError('') }} />
              <Dialog.Description mt="8px" fontSize="12px" color="var(--muted)" lineHeight="1.8">{action === 'rename' ? 'The current folder and Markdown extension are kept.' : 'Use a folder path such as Journal/Ideas. Leave empty to move to the top level.'} Your note link and version history stay the same.</Dialog.Description>
              {target ? <Text fontSize="12px" mt="14px" overflowWrap="anywhere">New path: {target}</Text> : <Text role="alert" fontSize="12px" color="fg.error" mt="14px">Enter a valid {action === 'rename' ? 'note name without slashes' : 'folder path without parent directory segments'}.</Text>}
            </>}
            {error && <Text role="alert" color="fg.error" fontSize="13px" mt="16px">{error}</Text>}
          </Dialog.Body>
          <Dialog.Footer>
            <ActionButton asChild><chakra.button ref={cancelButton} type="button" disabled={busy} onClick={() => setAction(null)}>Cancel</chakra.button></ActionButton>
            <ActionButton type="submit" loading={busy} disabled={disabled || dirty || needsReload || (action !== 'delete' && (!target || target === file.key))} color={action === 'delete' ? 'fg.error' : undefined}>{action === 'delete' ? 'Confirm delete' : action === 'rename' ? 'Save name' : 'Move note'}</ActionButton>
          </Dialog.Footer>
        </form></Box>
      </Dialog.Content></Dialog.Positioner></Portal>
    </Dialog.Root>
  </>
}
