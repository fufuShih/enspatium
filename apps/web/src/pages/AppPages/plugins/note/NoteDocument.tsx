import { Box, Dialog, Flex, Heading, Portal, Text, chakra } from '@chakra-ui/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useBlocker, useNavigate } from 'react-router'
import { ActionButton } from '../../../../components/ui/Primitives'
import RequestState from '../../../../components/RequestState'
import { useAuth } from '../../../../context/auth'
import { refreshObjectLists } from '../../../SpacesPage/object/objectFileApi'
import type { AppInstance } from '../../types'
import { loadNote, saveNote } from './integration'
import { noteError } from './noteErrors'
import NoteEditor from './NoteEditor'
import NoteActions from './NoteActions'
import { appPath } from '../../paths'
import { useOnline } from '../../../../hooks/useOnline'

const autoSaveDelayMs = 1500

function RefreshIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6v5h-5" /><path d="M19 11a8 8 0 1 0 .2 5" /></svg>
}

type EditingState = { locked: boolean; key: string | null }

export default function NoteDocument({ instance, id, editable, onEditingStateChange }: { instance: AppInstance; id: string; editable: boolean; onEditingStateChange: (state: EditingState) => void }) {
  const { user } = useAuth()
  const [reload, setReload] = useState(0)
  const note = useQuery({
    queryKey: ['note-document', instance.id, id, user?.id ?? null, reload],
    queryFn: ({ signal }) => loadNote(instance, id, signal), retry: false, gcTime: 0,
    // A live editor owns its draft. Focus/background refresh must never replace it.
    staleTime: Infinity, refetchOnWindowFocus: false,
  })
  if (note.isPending) return <RequestState loading title="Opening note..." />
  if (note.isError) return <RequestState title="Unable to open note" message={noteError(note.error)} onRetry={() => { void note.refetch() }} />
  return <OpenNote key={`${id}:${reload}`} instance={instance} loaded={note.data} editable={editable} onReload={() => setReload(value => value + 1)} onEditingStateChange={onEditingStateChange} />
}

function OpenNote({ instance, loaded, editable, onReload, onEditingStateChange }: { instance: AppInstance; loaded: Awaited<ReturnType<typeof loadNote>>; editable: boolean; onReload: () => void; onEditingStateChange: (state: EditingState) => void }) {
  const online = useOnline()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [content, setContent] = useState(loaded.content)
  const [saved, setSaved] = useState(loaded.content)
  const [file, setFile] = useState(loaded.file)
  const [deleted, setDeleted] = useState(false)
  const [managing, setManaging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [autoSavePaused, setAutoSavePaused] = useState(false)
  const saving = useRef(false)
  const saveLatest = useRef<(source?: 'manual' | 'auto') => Promise<void>>(async () => undefined)
  const stayButton = useRef<HTMLButtonElement>(null)
  const [error, setError] = useState('')
  const dirty = content !== saved
  const working = busy || managing
  const blocker = useBlocker(({ currentLocation, nextLocation }) => !deleted && (dirty || working) && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => { onEditingStateChange({ locked: dirty || working, key: file.key }) }, [dirty, file.key, onEditingStateChange, working])
  useEffect(() => () => onEditingStateChange({ locked: false, key: null }), [onEditingStateChange])
  useEffect(() => {
    if (deleted) navigate(appPath('note', instance.id), { replace: true })
  }, [deleted, navigate, instance.id])
  useEffect(() => {
    if (deleted || (!dirty && !working)) return
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [dirty, working, deleted])

  async function save(source: 'manual' | 'auto' = 'manual') {
    if (!navigator.onLine) { setError('You are offline. Reconnect and save explicitly, or download your draft.'); return }
    if (!editable || !dirty || working || deleted || saving.current) return
    const snapshot = content
    saving.current = true; setBusy(true); setError('')
    try {
      const updated = await saveNote(instance, file.key, snapshot, file.versionId)
      setFile(previous => ({ ...previous, ...updated })); setSaved(snapshot); setAutoSavePaused(false)
      // Keep background saves cheap; active lists already refresh periodically.
      if (source === 'manual') await refreshObjectLists(client, instance.account, instance.slug)
    } catch (failure) { setAutoSavePaused(true); setError(noteError(failure)) }
    finally { saving.current = false; setBusy(false) }
  }
  useEffect(() => { saveLatest.current = save })
  useEffect(() => {
    if (!editable || !online || !dirty || working || deleted || autoSavePaused) return
    const timer = window.setTimeout(() => { void saveLatest.current('auto') }, autoSaveDelayMs)
    return () => window.clearTimeout(timer)
  }, [autoSavePaused, content, deleted, dirty, editable, online, saved, working])
  useEffect(() => {
    if (blocker.state === 'blocked' && !dirty && !working) blocker.proceed?.()
  }, [blocker, dirty, working])
  function reload() {
    if (!dirty || window.confirm('Discard your unsaved changes and reload this note?')) onReload()
  }
  function downloadDraft() {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown' }))
    const link = document.createElement('a')
    link.href = url; link.download = file.key.split('/').at(-1)!
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const saveStatus = busy || (dirty && online && !autoSavePaused) ? 'Saving…' : dirty ? autoSavePaused ? 'Autosave paused' : 'Waiting for connection' : 'Saved'
  return <>
    <Flex align="center" gap="12px" mb="28px" flexWrap="wrap">
      <Box flex={{ base: '1 0 100%', lg: '1' }} minW="0"><Text color="var(--muted)" fontSize="11px" mb="7px" overflowWrap="anywhere">{file.key}</Text><Heading as="h1" fontSize="25px" fontWeight="500" letterSpacing="-.03em" overflowWrap="anywhere">{file.key.split('/').at(-1)!.replace(/\.(md|markdown)$/i, '')}</Heading></Box>
      <Flex align="center" gap="8px" minH="36px" flexShrink="0">
        <Text role="status" title={saveStatus} width="104px" flexShrink="0" textAlign="right" whiteSpace="nowrap" overflow="hidden" textOverflow="ellipsis" fontSize="12px" lineHeight="20px" color="var(--muted)">{saveStatus}</Text>
        <ActionButton aria-label="Refresh note" title="Refresh note" onClick={reload} disabled={!online || working || deleted} width="36px" height="36px" p="0"><RefreshIcon /></ActionButton>
        {editable && <>
          <ActionButton onClick={() => { void save('manual') }} disabled={!online || !dirty || working || deleted} bg="var(--surface-strong)" minH="36px">Save</ActionButton>
          <NoteActions instance={instance} file={file} dirty={dirty} disabled={!online || working || deleted} onBusy={setManaging} onMoved={moved => { setFile(previous => ({ ...previous, ...moved })); setError('') }} onDeleted={() => setDeleted(true)} />
        </>}
      </Flex>
    </Flex>
    {(error || !online) && <Box mb="20px" border="1px solid var(--border)" borderRadius="8px" p="14px"><Text role="alert" color="fg.error" fontSize="13px">{error || 'You are offline. Editing is paused; keep this tab open or download your unsaved draft.'}</Text>{dirty && <ActionButton mt="10px" onClick={downloadDraft}>Download draft</ActionButton>}</Box>}
    <NoteEditor initialContent={loaded.content} editable={online && editable && !working && !deleted} onChange={value => { setContent(value); setAutoSavePaused(false) }} onSave={() => { void save('manual') }} />
    <Dialog.Root role="alertdialog" open={blocker.state === 'blocked'} onOpenChange={event => { if (!event.open) blocker.reset?.() }} placement="center" initialFocusEl={() => stayButton.current}>
      <Portal><Dialog.Backdrop /><Dialog.Positioner p="20px"><Dialog.Content bg="var(--background)" color="var(--foreground)" border="1px solid var(--border)" borderRadius="12px" maxW="380px">
        <Dialog.Header><Dialog.Title fontSize="18px">{working ? 'Updating your note' : 'Leave without saving?'}</Dialog.Title></Dialog.Header>
        <Dialog.Body><Dialog.Description fontSize="13px" color="var(--muted)">{working ? 'Wait for the update to finish before leaving.' : 'Your changes will be lost. Stay to save them first.'}</Dialog.Description></Dialog.Body>
        <Dialog.Footer><ActionButton asChild><chakra.button ref={stayButton} onClick={() => blocker.reset?.()}>Stay</chakra.button></ActionButton><ActionButton disabled={working} onClick={() => blocker.proceed?.()}>Discard changes</ActionButton></Dialog.Footer>
      </Dialog.Content></Dialog.Positioner></Portal>
    </Dialog.Root>
  </>
}
