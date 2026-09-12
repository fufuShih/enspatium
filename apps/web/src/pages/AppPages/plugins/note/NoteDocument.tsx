import { Box, Dialog, Flex, Heading, Portal, Text, chakra } from '@chakra-ui/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useBlocker } from 'react-router'
import { ActionButton } from '../../../../components/ui/Primitives'
import RequestState from '../../../../components/RequestState'
import { useAuth } from '../../../../context/auth'
import { refreshObjectLists } from '../../../SpacesPage/object/objectFileApi'
import type { AppSpace } from '../../types'
import { loadNote, saveNote } from './integration'
import { noteError } from './noteErrors'
import NoteEditor from './NoteEditor'

export default function NoteDocument({ space, id, editable }: { space: AppSpace; id: string; editable: boolean }) {
  const { user } = useAuth()
  const [reload, setReload] = useState(0)
  const note = useQuery({
    queryKey: ['note-document', space.id, id, user?.id ?? null, reload],
    queryFn: ({ signal }) => loadNote(space, id, signal), retry: false, gcTime: 0,
    // A live editor owns its draft. Focus/background refresh must never replace it.
    staleTime: Infinity, refetchOnWindowFocus: false,
  })
  if (note.isPending) return <RequestState loading title="Opening note..." />
  if (note.isError) return <RequestState title="Unable to open note" message={noteError(note.error)} onRetry={() => { void note.refetch() }} />
  return <OpenNote key={`${id}:${reload}`} space={space} loaded={note.data} editable={editable} onReload={() => setReload(value => value + 1)} />
}

function OpenNote({ space, loaded, editable, onReload }: { space: AppSpace; loaded: Awaited<ReturnType<typeof loadNote>>; editable: boolean; onReload: () => void }) {
  const client = useQueryClient()
  const [content, setContent] = useState(loaded.content)
  const [saved, setSaved] = useState(loaded.content)
  const [version, setVersion] = useState(loaded.file.versionId)
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const stayButton = useRef<HTMLButtonElement>(null)
  const [error, setError] = useState('')
  const dirty = content !== saved
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (dirty || busy) && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => {
    if (!dirty && !busy) return
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [dirty, busy])

  async function save() {
    if (!editable || !dirty || saving.current) return
    saving.current = true; setBusy(true); setError('')
    try {
      const file = await saveNote(space, loaded.file.key, content, version)
      setVersion(file.versionId); setSaved(content)
      await refreshObjectLists(client, space.account, space.slug)
    } catch (failure) { setError(noteError(failure)) }
    finally { saving.current = false; setBusy(false) }
  }
  function reload() {
    if (!dirty || window.confirm('Discard your unsaved changes and reload this note?')) onReload()
  }
  function downloadDraft() {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown' }))
    const link = document.createElement('a')
    link.href = url; link.download = loaded.file.key.split('/').at(-1)!
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <>
    <Flex align="center" gap="12px" mb="28px" flexWrap="wrap">
      <Box flex="1" minW="0"><Text color="var(--muted)" fontSize="11px" mb="7px" overflowWrap="anywhere">{loaded.file.key}</Text><Heading as="h1" fontSize="25px" fontWeight="500" letterSpacing="-.03em" overflowWrap="anywhere">{loaded.file.key.split('/').at(-1)!.replace(/\.(md|markdown)$/i, '')}</Heading></Box>
      <Text role="status" fontSize="12px" color="var(--muted)">{busy ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'}</Text>
      <ActionButton onClick={reload} disabled={busy}>Reload note</ActionButton>
      {editable && <ActionButton onClick={() => { void save() }} disabled={!dirty || busy} bg="var(--surface-strong)">Save</ActionButton>}
    </Flex>
    {error && <Box mb="20px" border="1px solid var(--border)" borderRadius="8px" p="14px"><Text role="alert" color="fg.error" fontSize="13px">{error}</Text>{dirty && <ActionButton mt="10px" onClick={downloadDraft}>Download draft</ActionButton>}</Box>}
    <NoteEditor initialContent={loaded.content} editable={editable && !busy} onChange={setContent} onSave={() => { void save() }} />
    <Dialog.Root role="alertdialog" open={blocker.state === 'blocked'} onOpenChange={event => { if (!event.open) blocker.reset?.() }} placement="center" initialFocusEl={() => stayButton.current}>
      <Portal><Dialog.Backdrop /><Dialog.Positioner p="20px"><Dialog.Content bg="var(--background)" color="var(--foreground)" border="1px solid var(--border)" borderRadius="12px" maxW="380px">
        <Dialog.Header><Dialog.Title fontSize="18px">{busy ? 'Saving your note' : 'Leave without saving?'}</Dialog.Title></Dialog.Header>
        <Dialog.Body><Dialog.Description fontSize="13px" color="var(--muted)">{busy ? 'Wait for the save to finish before leaving.' : 'Your changes will be lost. Stay to save them first.'}</Dialog.Description></Dialog.Body>
        <Dialog.Footer><ActionButton asChild><chakra.button ref={stayButton} onClick={() => blocker.reset?.()}>Stay</chakra.button></ActionButton><ActionButton disabled={busy} onClick={() => blocker.proceed?.()}>Discard changes</ActionButton></Dialog.Footer>
      </Dialog.Content></Dialog.Positioner></Portal>
    </Dialog.Root>
  </>
}
