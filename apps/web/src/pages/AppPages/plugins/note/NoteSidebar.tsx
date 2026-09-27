import { Box, Flex, Text, chakra } from '@chakra-ui/react'
import { useState } from 'react'
import { ActionButton, PageLink, TextInput } from '../../../../components/ui/Primitives'
import type { ListAppInstanceObjects200ObjectsItem } from '../../../../api/generated/api.schemas'
import type { AppInstance } from '../../types'
import { appPath } from '../../paths'
import { noteFileKey, saveNote } from './integration'
import { noteError } from './noteErrors'
import { useOnline } from '../../../../hooks/useOnline'
import { apiStatus } from '../../../../context/session'
import { createObjectFolder, objectFolderPath } from '../../../SpacesPage/object/objectFolderApi'

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

export function NoteList({ notes, appId, selected }: { notes: NoteItem[]; appId: string; selected?: string }) {
  function render(tree: Tree) {
    return <>
      {[...tree.folders].sort(([left], [right]) => left.localeCompare(right)).map(([name, child]) => <Box asChild key={name}><details open>
        <chakra.summary cursor="pointer" p="8px" fontSize="12px" color="var(--muted)" borderRadius="5px" _hover={{ bg: 'var(--surface-strong)' }}><Box as="span" display="inline-flex" alignItems="center" gap="7px"><NoteIcon folder />{name}</Box></chakra.summary>
        <Box pl="12px" ml="10px" borderLeft="1px solid var(--border)">{render(child)}</Box>
      </details></Box>)}
      {tree.notes.sort((left, right) => left.key.localeCompare(right.key)).map(note => <PageLink key={note.id} to={appPath('note', appId, 'note', note.id)} aria-label={`Open ${note.key}`} aria-current={selected === note.id ? 'page' : undefined} display="flex" alignItems="center" gap="9px" p="9px 10px" my="2px" borderRadius="5px" bg={selected === note.id ? 'var(--surface-strong)' : 'transparent'} color={selected === note.id ? 'var(--foreground)' : 'var(--muted)'} _hover={{ bg: 'var(--surface-strong)', color: 'var(--foreground)' }} fontSize="13px">
        <NoteIcon /><Text truncate>{note.key.split('/').at(-1)!.replace(/\.(md|markdown)$/i, '')}</Text>
      </PageLink>)}
    </>
  }
  return <Box as="nav" aria-label="Notes and folders">{render(noteTree(notes))}</Box>
}

export function NewNote({ instance, folders, onCreated, onCancel }: { instance: AppInstance; folders: string[]; onCreated: (id: string) => void; onCancel: () => void }) {
  const online = useOnline()
  const [folder, setFolder] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <Box asChild mb="16px"><form onSubmit={async event => {
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
    <chakra.label htmlFor="new-note-folder" fontSize="12px" display="block" mb="7px">Folder</chakra.label>
    <chakra.select id="new-note-folder" value={folder} disabled={!online || busy} onChange={event => setFolder(event.target.value)} width="100%" minH="36px" px="9px" mb="10px" border="1px solid var(--border)" borderRadius="6px" bg="var(--background)" fontSize="13px">
      <option value="">Top level</option>
      {folders.map(path => <option key={path} value={path}>{path}</option>)}
    </chakra.select>
    <chakra.label htmlFor="new-note-name" fontSize="12px" display="block" mb="7px">Note filename</chakra.label>
    <TextInput id="new-note-name" autoFocus required maxLength={255} placeholder="Meeting notes" value={name} disabled={!online || busy} onChange={event => setName(event.target.value)} />
    <Text fontSize="11px" color="var(--muted)" mt="7px">Markdown (.md) is added automatically.</Text>
    {error && <Text role="alert" color="fg.error" fontSize="12px" mt="8px">{error}</Text>}
    <Flex gap="6px" mt="10px"><ActionButton type="submit" disabled={!online} loading={busy} size="xs">Create note</ActionButton><ActionButton type="button" disabled={busy} onClick={onCancel} size="xs">Cancel</ActionButton></Flex>
  </form></Box>
}

export function NewFolder({ instance, onCreated, onCancel }: { instance: AppInstance; onCreated: () => void; onCancel: () => void }) {
  const online = useOnline()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <Box asChild mb="16px"><form onSubmit={async event => {
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
    <chakra.label htmlFor="new-folder-path" fontSize="12px" display="block" mb="7px">Folder path</chakra.label>
    <TextInput id="new-folder-path" autoFocus required maxLength={1023} placeholder="Projects/Ideas" value={name} disabled={!online || busy} onChange={event => setName(event.target.value)} />
    <Text fontSize="11px" color="var(--muted)" mt="7px">Use / to create nested folders.</Text>
    {error && <Text role="alert" color="fg.error" fontSize="12px" mt="8px">{error}</Text>}
    <Flex gap="6px" mt="10px"><ActionButton type="submit" disabled={!online} loading={busy} size="xs">Create folder</ActionButton><ActionButton type="button" disabled={busy} onClick={onCancel} size="xs">Cancel</ActionButton></Flex>
  </form></Box>
}
