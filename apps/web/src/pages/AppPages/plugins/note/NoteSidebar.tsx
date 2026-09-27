import { Box, Dialog, Flex, Portal, Text, chakra } from '@chakra-ui/react'
import { useRef, useState, type DragEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ActionButton, PageLink, TextInput } from '../../../../components/ui/Primitives'
import type { ListAppInstanceObjects200ObjectsItem } from '../../../../api/generated/api.schemas'
import { moveObject, moveObjectFolder } from '../../../../api/generated/objects'
import type { AppInstance } from '../../types'
import { appPath } from '../../paths'
import { noteFileKey, saveNote } from './integration'
import { noteError } from './noteErrors'
import { useOnline } from '../../../../hooks/useOnline'
import { apiCode, apiStatus } from '../../../../context/session'
import { createObjectFolder, objectFolderPath } from '../../../SpacesPage/object/objectFolderApi'
import { fileErrorMessage, refreshObjectLists } from '../../../SpacesPage/object/objectFileApi'
import { dragItemContainsKey, noteDropMove, type NoteDragItem } from './noteDragDrop'
import NoteSidebarActions from './NoteSidebarActions'

export function NoteIcon({ folder = false }: { folder?: boolean }) {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" style={{ flexShrink: 0 }}>{folder ? <path d="M3 7V5h6l2 2h10v13H3V7Z" /> : <><path d="M6 3h9l4 4v14H6V3Z" /><path d="M14 3v5h5M9 12h7M9 16h5" /></>}</svg>
}

type NoteItem = ListAppInstanceObjects200ObjectsItem
type Tree = { folders: Map<string, Tree>; notes: NoteItem[] }

function ensureFolders(root: Tree, parts: string[]) {
  let current = root
  for (const part of parts) {
    if (!current.folders.has(part)) current.folders.set(part, { folders: new Map(), notes: [] })
    current = current.folders.get(part)!
  }
  return current
}

function noteTree(items: NoteItem[]) {
  const root: Tree = { folders: new Map(), notes: [] }
  for (const item of items) {
    const parent = ensureFolders(root, item.key.split('/').slice(0, -1))
    if (item.kind !== 'folder') parent.notes.push(item)
  }
  return root
}

export function NoteList({ notes, instance, selected, selectedKey, selectedLocked, editable, onMoved, onDeleted }: {
  notes: NoteItem[]; instance: AppInstance; selected?: string; selectedKey?: string; selectedLocked: boolean; editable: boolean
  onMoved: (item: NoteDragItem) => void; onDeleted: (item: NoteDragItem) => void
}) {
  const client = useQueryClient()
  const dragging = useRef<NoteDragItem | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  function dragLocked(item: NoteDragItem) {
    return Boolean(selectedLocked && selectedKey && dragItemContainsKey(item, selectedKey))
  }
  function startDrag(event: DragEvent, item: NoteDragItem) {
    if (!editable || working || dragLocked(item)) { event.preventDefault(); return }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', item.kind === 'note' ? item.key : item.prefix)
    setError(''); dragging.current = item
  }
  function dragOver(event: DragEvent, destination: string) {
    if (!dragging.current || !noteDropMove(dragging.current, destination)) return
    event.preventDefault(); event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setDropTarget(destination)
  }
  async function drop(event: DragEvent, destination: string) {
    event.preventDefault(); event.stopPropagation()
    const item = dragging.current
    const planned = item && noteDropMove(item, destination)
    setDropTarget(null)
    if (!item || !planned || working) return
    if (!navigator.onLine) { setError('Reconnect before moving notes or folders.'); return }
    setWorking(true); setError('')
    try {
      if (item.kind === 'note' && planned.kind === 'note') {
        await moveObject(instance.account, instance.slug, { objectId: item.id, key: item.key, newKey: planned.newKey, expectedVersion: item.versionId })
      } else if (item.kind === 'folder' && planned.kind === 'folder') {
        await moveObjectFolder(instance.account, instance.slug, { prefix: item.prefix, newPrefix: planned.newPrefix })
      }
      onMoved(item)
      await refreshObjectLists(client, instance.account, instance.slug).catch(() => {})
      dragging.current = null
    } catch (failure) {
      setError(apiCode(failure) === 'OBJECT_KEY_CONFLICT' ? 'That destination already contains a file or folder with the same name.' : fileErrorMessage(failure, 'move'))
    } finally { setWorking(false) }
  }
  function render(tree: Tree, parent = '') {
    return <>
      {[...tree.folders].sort(([left], [right]) => left.localeCompare(right)).map(([name, child]) => {
        const path = parent ? `${parent}/${name}` : name
        const item = { kind: 'folder', prefix: path + '/' } as const
        const locked = dragLocked(item)
        return <Box key={name}>
          <Flex role="group" aria-label={`Folder ${path}`} draggable={editable && !working && !locked} title={locked ? 'Wait for the open note to finish saving before moving this folder.' : editable ? 'Drag folder' : undefined} onDragStart={event => startDrag(event, item)} onDragEnd={() => { dragging.current = null; setDropTarget(null) }} onDragOver={event => dragOver(event, path)} onDrop={event => { void drop(event, path) }} cursor={locked ? 'not-allowed' : editable ? 'grab' : 'default'} align="center" gap="2px" p="4px 2px 4px 8px" minH="33px" fontSize="12px" color="var(--muted)" borderRadius="5px" bg={dropTarget === path ? 'var(--surface-strong)' : 'transparent'} outline={dropTarget === path ? '1px dashed var(--accent-ink)' : 'none'} _hover={{ bg: 'var(--surface-strong)' }}>
            <Flex align="center" gap="7px" minW="0" flex="1"><NoteIcon folder /><Text truncate>{name}</Text></Flex>
            {editable && <NoteSidebarActions instance={instance} item={item} disabled={working || locked} onBusy={setWorking} onMoved={onMoved} onDeleted={onDeleted} />}
          </Flex>
          <Box pl="12px" ml="10px" borderLeft="1px solid var(--border)">{render(child, path)}</Box>
        </Box>
      })}
      {tree.notes.sort((left, right) => left.key.localeCompare(right.key)).map(note => {
        const item = { kind: 'note', id: note.id, key: note.key, versionId: note.versionId } as const
        const locked = dragLocked(item)
        return <Flex key={note.id} role="group" draggable={editable && !working && !locked} title={locked ? 'Wait for this note to finish saving before moving it.' : editable ? 'Drag note' : undefined} onDragStart={event => startDrag(event, item)} onDragEnd={() => { dragging.current = null; setDropTarget(null) }} align="center" gap="1px" p="1px 2px 1px 2px" my="2px" borderRadius="5px" bg={selected === note.id ? 'var(--surface-strong)' : 'transparent'} color={selected === note.id ? 'var(--foreground)' : 'var(--muted)'} cursor={locked ? 'not-allowed' : editable ? 'grab' : 'default'} _hover={{ bg: 'var(--surface-strong)', color: 'var(--foreground)' }} fontSize="13px">
          <PageLink to={appPath('note', instance.id, 'note', note.id)} draggable={false} aria-label={`Open ${note.key}`} aria-current={selected === note.id ? 'page' : undefined} display="flex" alignItems="center" gap="8px" p="6px 7px" minW="0" flex="1" color="inherit"><NoteIcon /><Text truncate>{note.key.split('/').at(-1)!.replace(/\.(md|markdown)$/i, '')}</Text></PageLink>
          {editable && <NoteSidebarActions instance={instance} item={item} disabled={working || locked} onBusy={setWorking} onMoved={onMoved} onDeleted={onDeleted} />}
        </Flex>
      })}
    </>
  }
  return <Box as="nav" aria-label="Notes and folders">
    <Flex aria-label="Top level drop target" onDragOver={event => dragOver(event, '')} onDrop={event => { void drop(event, '') }} align="center" gap="7px" p="7px 9px" mb="5px" minH="32px" border="1px dashed" borderColor={dropTarget === '' ? 'var(--accent-ink)' : 'var(--border)'} borderRadius="5px" bg={dropTarget === '' ? 'var(--surface-strong)' : 'transparent'} color="var(--muted)" fontSize="11px"><NoteIcon folder />Top level {working && <Text ml="auto">Working…</Text>}</Flex>
    {error && <Text role="alert" color="fg.error" fontSize="12px" p="8px">{error}</Text>}
    {render(noteTree(notes))}
  </Box>
}

export function NewNote({ instance, folders, onCreated, onCancel }: { instance: AppInstance; folders: string[]; onCreated: (id: string) => void; onCancel: () => void }) {
  const online = useOnline()
  const input = useRef<HTMLInputElement>(null)
  const [folder, setFolder] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <Dialog.Root open onOpenChange={event => { if (!event.open && !busy) onCancel() }} placement="center" initialFocusEl={() => input.current} closeOnEscape={!busy} closeOnInteractOutside={!busy}>
    <Portal><Dialog.Backdrop /><Dialog.Positioner p="20px"><Dialog.Content bg="var(--background)" color="var(--foreground)" border="1px solid var(--border)" borderRadius="12px" maxW="440px">
      <Box asChild><form onSubmit={async event => {
        event.preventDefault()
        if (busy) return
        if (!navigator.onLine) { setError('Reconnect before creating a note.'); return }
        setBusy(true); setError('')
        try {
          const created = await saveNote(instance, noteFileKey(folder, name), '', 'none')
          onCreated(created.id)
        } catch (failure) { setError(noteError(failure, true)) }
        finally { setBusy(false) }
      }}>
        <Dialog.Header><Dialog.Title fontSize="18px">Create note</Dialog.Title></Dialog.Header>
        <Dialog.Body>
          <chakra.label htmlFor="new-note-folder" fontSize="13px" display="block" mb="7px">Folder</chakra.label>
          <chakra.select id="new-note-folder" value={folder} disabled={!online || busy} onChange={event => setFolder(event.target.value)} width="100%" minH="38px" px="10px" mb="16px" border="1px solid var(--border)" borderRadius="6px" bg="var(--background)" fontSize="13px">
            <option value="">Top level</option>
            {folders.map(path => <option key={path} value={path}>{path}</option>)}
          </chakra.select>
          <chakra.label htmlFor="new-note-name" fontSize="13px" display="block" mb="7px">Note filename</chakra.label>
          <TextInput id="new-note-name" ref={input} required maxLength={255} placeholder="Meeting notes" value={name} disabled={!online || busy} onChange={event => setName(event.target.value)} />
          <Text fontSize="11px" color="var(--muted)" mt="7px">Markdown (.md) is added automatically.</Text>
          {error && <Text role="alert" color="fg.error" fontSize="12px" mt="12px">{error}</Text>}
        </Dialog.Body>
        <Dialog.Footer>
          <ActionButton type="button" disabled={busy} onClick={onCancel}>Cancel</ActionButton>
          <ActionButton type="submit" disabled={!online} loading={busy}>Create note</ActionButton>
        </Dialog.Footer>
      </form></Box>
    </Dialog.Content></Dialog.Positioner></Portal>
  </Dialog.Root>
}

export function NewFolder({ instance, onCreated, onCancel }: { instance: AppInstance; onCreated: () => void; onCancel: () => void }) {
  const online = useOnline()
  const input = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <Dialog.Root open onOpenChange={event => { if (!event.open && !busy) onCancel() }} placement="center" initialFocusEl={() => input.current} closeOnEscape={!busy} closeOnInteractOutside={!busy}>
    <Portal><Dialog.Backdrop /><Dialog.Positioner p="20px"><Dialog.Content bg="var(--background)" color="var(--foreground)" border="1px solid var(--border)" borderRadius="12px" maxW="440px">
      <Box asChild><form onSubmit={async event => {
        event.preventDefault()
        if (busy) return
        const path = objectFolderPath(name)
        if (!path) { setError('Enter a valid folder path, such as Projects or Journal/2026.'); return }
        if (!navigator.onLine) { setError('Reconnect before creating a folder.'); return }
        setBusy(true); setError('')
        try {
          await createObjectFolder(instance.account, instance.slug, path)
          onCreated()
        } catch (failure) {
          setError(apiStatus(failure) === 409 ? 'This folder already exists, or its name conflicts with a note.' : noteError(failure, true))
        } finally { setBusy(false) }
      }}>
        <Dialog.Header><Dialog.Title fontSize="18px">Create folder</Dialog.Title></Dialog.Header>
        <Dialog.Body>
          <chakra.label htmlFor="new-folder-path" fontSize="13px" display="block" mb="7px">Folder path</chakra.label>
          <TextInput id="new-folder-path" ref={input} required maxLength={1023} placeholder="Projects/Ideas" value={name} disabled={!online || busy} onChange={event => setName(event.target.value)} />
          <Text fontSize="11px" color="var(--muted)" mt="7px">Use / to create nested folders.</Text>
          {error && <Text role="alert" color="fg.error" fontSize="12px" mt="12px">{error}</Text>}
        </Dialog.Body>
        <Dialog.Footer>
          <ActionButton type="button" disabled={busy} onClick={onCancel}>Cancel</ActionButton>
          <ActionButton type="submit" disabled={!online} loading={busy}>Create folder</ActionButton>
        </Dialog.Footer>
      </form></Box>
    </Dialog.Content></Dialog.Positioner></Portal>
  </Dialog.Root>
}
