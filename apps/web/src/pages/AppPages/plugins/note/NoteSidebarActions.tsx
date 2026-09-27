import { Box, Dialog, Flex, Portal, Text, chakra } from '@chakra-ui/react'
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { deleteObjectFolder, moveObject, moveObjectFolder } from '../../../../api/generated/objects'
import { ActionButton, TextInput } from '../../../../components/ui/Primitives'
import { apiCode, apiStatus } from '../../../../context/session'
import { deleteSelectedObject } from '../../../SpacesPage/object/objectDeletion'
import { fileErrorMessage, refreshObjectLists } from '../../../SpacesPage/object/objectFileApi'
import type { AppInstance } from '../../types'
import { noteFolderRenamePrefix, noteMoveKey } from './noteManagement'
import type { NoteDragItem } from './noteDragDrop'

type Action = 'rename' | 'delete'

function RenameIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" /><path d="m13.8 7.7 2.5 2.5" /></svg>
}

function DeleteIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>
}

function itemName(item: NoteDragItem) {
  const path = item.kind === 'note' ? item.key : item.prefix.slice(0, -1)
  const name = path.split('/').at(-1)!
  return item.kind === 'note' ? name.replace(/\.(md|markdown)$/i, '') : name
}

export default function NoteSidebarActions({ instance, item, disabled, onBusy, onMoved, onDeleted }: {
  instance: AppInstance
  item: NoteDragItem
  disabled: boolean
  onBusy: (busy: boolean) => void
  onMoved: (item: NoteDragItem) => void
  onDeleted: (item: NoteDragItem) => void
}) {
  const client = useQueryClient()
  const [action, setAction] = useState<Action | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const operation = useRef<AbortController | null>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const name = itemName(item)
  const target = action === 'rename'
    ? item.kind === 'note' ? noteMoveKey(item.key, 'rename', value) : noteFolderRenamePrefix(item.prefix, value)
    : null
  const current = item.kind === 'note' ? item.key : item.prefix

  useEffect(() => () => {
    if (operation.current) {
      operation.current.abort()
      onBusy(false)
    }
  }, [onBusy])

  function open(next: Action) {
    if (disabled) return
    setAction(next)
    setValue(name)
    setError('')
  }

  async function submit() {
    if (!action || operation.current || disabled || (action === 'rename' && (!target || target === current))) return
    if (!navigator.onLine) { setError(`Reconnect before ${action === 'delete' ? 'deleting' : 'renaming'} this ${item.kind}.`); return }
    const controller = new AbortController()
    operation.current = controller
    setBusy(true)
    onBusy(true)
    setError('')
    try {
      if (action === 'rename') {
        if (item.kind === 'note') {
          await moveObject(instance.account, instance.slug, {
            objectId: item.id, key: item.key, newKey: target!, expectedVersion: item.versionId,
          }, { signal: controller.signal })
        } else {
          await moveObjectFolder(instance.account, instance.slug, {
            prefix: item.prefix, newPrefix: target!,
          }, { signal: controller.signal })
        }
      } else if (item.kind === 'note') {
        await deleteSelectedObject(instance.account, instance.slug, item, controller.signal)
      } else {
        await deleteObjectFolder(instance.account, instance.slug, { prefix: item.prefix }, { signal: controller.signal })
      }
      if (!controller.signal.aborted) {
        setAction(null)
        if (action === 'delete') onDeleted(item)
        else onMoved(item)
      }
      await refreshObjectLists(client, instance.account, instance.slug).catch(() => {})
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(apiCode(failure) === 'OBJECT_KEY_CONFLICT'
          ? `This name is already used by another ${item.kind}.`
          : [404, 409].includes(apiStatus(failure) ?? 0)
            ? `This ${item.kind} changed or moved. Close this dialog and refresh the list.`
            : fileErrorMessage(failure, action === 'delete' ? 'delete' : 'move'))
      }
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false)
        onBusy(false)
      }
      operation.current = null
    }
  }

  const buttonTitle = disabled ? `Wait for the open note to finish saving before managing this ${item.kind}.` : undefined
  return <>
    <Flex flexShrink="0" gap="0" onPointerDown={event => event.stopPropagation()} onDragStart={event => { event.preventDefault(); event.stopPropagation() }}>
      <ActionButton aria-label={`Rename ${item.kind} ${name}`} title={buttonTitle ?? `Rename ${item.kind}`} disabled={disabled} onClick={() => open('rename')} width="24px" height="24px" minW="24px" p="0" border="0"><RenameIcon /></ActionButton>
      <ActionButton aria-label={`Delete ${item.kind} ${name}`} title={buttonTitle ?? `Delete ${item.kind}`} disabled={disabled} onClick={() => open('delete')} width="24px" height="24px" minW="24px" p="0" border="0" color="fg.error"><DeleteIcon /></ActionButton>
    </Flex>
    <Dialog.Root open={action !== null} onOpenChange={event => { if (!event.open && !busy) setAction(null) }} placement="center" initialFocusEl={() => action === 'delete' ? cancelButton.current : input.current} closeOnEscape={!busy} closeOnInteractOutside={!busy}>
      <Portal><Dialog.Backdrop /><Dialog.Positioner p="20px"><Dialog.Content bg="var(--background)" color="var(--foreground)" border="1px solid var(--border)" borderRadius="12px" maxW="440px">
        <Box asChild><form onSubmit={event => { event.preventDefault(); void submit() }}>
          <Dialog.Header><Dialog.Title fontSize="18px">{action === 'delete' ? `Delete this ${item.kind}?` : `Rename ${item.kind}`}</Dialog.Title></Dialog.Header>
          <Dialog.Body>
            <Text fontSize="12px" color="var(--muted)" mb="16px" overflowWrap="anywhere">{current}</Text>
            {action === 'delete' ? <Dialog.Description fontSize="13px" lineHeight="1.8">
              {item.kind === 'folder'
                ? 'Move this folder, all nested folders, and every note inside it to Deleted files?'
                : 'Move this note to Deleted files?'} You can restore deleted notes from Files until retention cleanup removes their content.
            </Dialog.Description> : <>
              <chakra.label htmlFor={`sidebar-rename-${item.kind}`} fontSize="13px">New name</chakra.label>
              <TextInput id={`sidebar-rename-${item.kind}`} ref={input} mt="8px" value={value} disabled={busy} maxLength={255} onChange={event => { setValue(event.target.value); setError('') }} />
              <Dialog.Description mt="8px" fontSize="12px" color="var(--muted)">The current parent folder is kept.</Dialog.Description>
              {target ? <Text fontSize="12px" mt="14px" overflowWrap="anywhere">New path: {target}</Text> : <Text role="alert" fontSize="12px" color="fg.error" mt="14px">Enter a valid name without slashes.</Text>}
            </>}
            {error && <Text role="alert" color="fg.error" fontSize="13px" mt="16px">{error}</Text>}
          </Dialog.Body>
          <Dialog.Footer>
            <ActionButton asChild><chakra.button ref={cancelButton} type="button" disabled={busy} onClick={() => setAction(null)}>Cancel</chakra.button></ActionButton>
            <ActionButton type="submit" loading={busy} disabled={disabled || (action === 'rename' && (!target || target === current))} color={action === 'delete' ? 'fg.error' : undefined}>{action === 'delete' ? 'Confirm delete' : 'Save name'}</ActionButton>
          </Dialog.Footer>
        </form></Box>
      </Dialog.Content></Dialog.Positioner></Portal>
    </Dialog.Root>
  </>
}
