import { Box, Flex, Text, chakra } from '@chakra-ui/react'
import { useState } from 'react'
import { ActionButton, PageLink, TextInput } from '../../../../components/ui/Primitives'
import type { ListAppObjects200ObjectsItem } from '../../../../api/generated/api.schemas'
import type { AppSpace } from '../../types'
import { appPath } from '../../paths'
import { noteKey, saveNote } from './integration'
import { noteError } from './noteErrors'

export function NoteIcon({ folder = false }: { folder?: boolean }) {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" style={{ flexShrink: 0 }}>{folder ? <path d="M3 7V5h6l2 2h10v13H3V7Z" /> : <><path d="M6 3h9l4 4v14H6V3Z" /><path d="M14 3v5h5M9 12h7M9 16h5" /></>}</svg>
}

type Tree = { folders: Map<string, Tree>; notes: ListAppObjects200ObjectsItem[] }
function noteTree(notes: ListAppObjects200ObjectsItem[]) {
  const root: Tree = { folders: new Map(), notes: [] }
  for (const note of notes) {
    let current = root
    for (const part of note.key.split('/').slice(0, -1)) {
      if (!current.folders.has(part)) current.folders.set(part, { folders: new Map(), notes: [] })
      current = current.folders.get(part)!
    }
    current.notes.push(note)
  }
  return root
}

export function NoteList({ notes, spaceId, selected }: { notes: ListAppObjects200ObjectsItem[]; spaceId: string; selected?: string }) {
  function render(tree: Tree) {
    return <>
      {[...tree.folders].map(([name, child]) => <Box asChild key={name}><details open>
        <chakra.summary cursor="pointer" p="8px" fontSize="12px" color="var(--muted)" borderRadius="5px" _hover={{ bg: 'var(--surface-strong)' }}><Box as="span" display="inline-flex" alignItems="center" gap="7px"><NoteIcon folder />{name}</Box></chakra.summary>
        <Box pl="12px" ml="10px" borderLeft="1px solid var(--border)">{render(child)}</Box>
      </details></Box>)}
      {tree.notes.map(note => <PageLink key={note.id} to={appPath('note', spaceId, 'note', note.id)} aria-label={`Open ${note.key}`} aria-current={selected === note.id ? 'page' : undefined} display="flex" alignItems="center" gap="9px" p="9px 10px" my="2px" borderRadius="5px" bg={selected === note.id ? 'var(--surface-strong)' : 'transparent'} color={selected === note.id ? 'var(--foreground)' : 'var(--muted)'} _hover={{ bg: 'var(--surface-strong)', color: 'var(--foreground)' }} fontSize="13px">
        <NoteIcon /><Text truncate>{note.key.split('/').at(-1)!.replace(/\.(md|markdown)$/i, '')}</Text>
      </PageLink>)}
    </>
  }
  return <Box as="nav" aria-label="Notes">{render(noteTree(notes))}</Box>
}

export function NewNote({ space, onCreated, onCancel }: { space: AppSpace; onCreated: (id: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <Box asChild mb="16px"><form onSubmit={async event => {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      const created = await saveNote(space, noteKey(name), '', 'none')
      onCreated(created.id)
    } catch (failure) { setError(noteError(failure, true)) }
    finally { setBusy(false) }
  }}>
    <chakra.label htmlFor="new-note-name" fontSize="12px" display="block" mb="7px">Note name</chakra.label>
    <TextInput id="new-note-name" autoFocus required maxLength={1024} placeholder="Journal/Today" value={name} disabled={busy} onChange={event => setName(event.target.value)} />
    <Text fontSize="11px" color="var(--muted)" mt="7px">Use / to place a note in a folder.</Text>
    {error && <Text role="alert" color="fg.error" fontSize="12px" mt="8px">{error}</Text>}
    <Flex gap="6px" mt="10px"><ActionButton type="submit" loading={busy} size="xs">Create note</ActionButton><ActionButton type="button" disabled={busy} onClick={onCancel} size="xs">Cancel</ActionButton></Flex>
  </form></Box>
}
