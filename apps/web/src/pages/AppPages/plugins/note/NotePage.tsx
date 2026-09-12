import { Box, Flex, Heading, Text } from '@chakra-ui/react'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { ActionButton, PageLink, TextInput } from '../../../../components/ui/Primitives'
import RequestState from '../../../../components/RequestState'
import { useAuth } from '../../../../context/auth'
import { apiStatus } from '../../../../context/session'
import { refreshObjectLists } from '../../../SpacesPage/object/objectFileApi'
import { spacePath } from '../../../SpacesPage/shared/spaceApi'
import type { AppPageProps } from '../../types'
import { appPath } from '../../paths'
import { noteIntegration } from './integration'
import { noteError } from './noteErrors'
import { NewNote, NoteIcon, NoteList } from './NoteSidebar'
import NoteDocument from './NoteDocument'

export default function NotePage({ space, basePath }: AppPageProps) {
  const { noteId } = useParams()
  const { user } = useAuth()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [search, setSearch] = useSearchParams()
  const filter = search.get('search') || ''
  const [creating, setCreating] = useState(false)
  const params = { search: filter || undefined, cursor: search.get('after') || undefined, limit: 100 }
  const notes = noteIntegration.useList(space.account, space.slug, params, { query: {
    queryKey: [...noteIntegration.listQueryKey(space.account, space.slug, params), user?.id ?? null],
    retry: false, gcTime: 0, staleTime: 0, refetchOnMount: 'always', refetchInterval: 30_000,
  } })
  const canWrite = !notes.isError && Boolean(notes.data?.canUpload)
  const accessDenied = notes.isError && [401, 403, 404].includes(apiStatus(notes.error) ?? 0)
  return <Box minH="100dvh" bg="var(--background)" color="var(--foreground)" css={{ '& :is(button, a, summary)': { cursor: 'pointer' }, '& :is(button, a, input, summary):focus-visible': { outline: '2px solid var(--accent-ink)', outlineOffset: '3px' } }}>
    <Flex as="header" align="center" gap="12px" px={{ base: '20px', md: '28px' }} h="64px" borderBottom="1px solid var(--border)">
      <PageLink to={basePath} display="flex" alignItems="center" gap="10px" fontWeight="600"><NoteIcon />Note</PageLink>
      <Text fontSize="13px" color="var(--muted)" truncate flex="1">{space.name}</Text>
      <PageLink to={spacePath(space.account, space.slug)} fontSize="12px" color="var(--muted)">Files ↗</PageLink>
    </Flex>
    <Box display="grid" gridTemplateColumns={{ base: '1fr', md: '250px minmax(0, 1fr)' }} minH="calc(100dvh - 64px)">
      <Box as="aside" bg="var(--surface)" borderRight={{ md: '1px solid var(--border)' }} borderBottom={{ base: '1px solid var(--border)', md: '0' }} p="18px 14px" position={{ md: 'sticky' }} top="0" alignSelf="start" h={{ md: 'calc(100dvh - 64px)' }} overflowY="auto" maxH={{ base: noteId ? '240px' : '340px', md: 'none' }}>
        <Flex align="center" justify="space-between" mb="18px"><Text fontSize="10px" letterSpacing=".12em" color="var(--muted)" px="8px">YOUR NOTES</Text>{canWrite && <ActionButton onClick={() => setCreating(value => !value)} p="6px 9px" fontSize="12px">+ New note</ActionButton>}</Flex>
        {creating && canWrite && <NewNote space={space} onCancel={() => setCreating(false)} onCreated={id => {
          setCreating(false)
          void refreshObjectLists(client, space.account, space.slug)
          navigate(appPath('note', space.id, 'note', id))
        }} />}
        <Box asChild mb="16px"><form role="search" onSubmit={event => {
          event.preventDefault()
          const value = String(new FormData(event.currentTarget).get('search') || '').trim()
          setSearch(value ? { search: value } : {})
        }}><TextInput key={filter} name="search" aria-label="Search notes" defaultValue={filter} placeholder="Search notes…" maxLength={128} bg="var(--background)" /><ActionButton type="submit" mt="6px" p="4px 8px" fontSize="11px">Search</ActionButton></form></Box>
        {notes.isPending ? <Text role="status" p="10px" fontSize="12px">Loading notes…</Text> : notes.isError ? <Box p="8px"><Text role="alert" fontSize="12px">{noteError(notes.error)}</Text><ActionButton mt="10px" onClick={() => { void notes.refetch() }}>Retry</ActionButton></Box> : <>
          <NoteList notes={notes.data.objects} spaceId={space.id} selected={noteId} />
          {!notes.data.objects.length && <Text fontSize="12px" color="var(--muted)" p="10px">{filter ? 'No matching notes.' : 'No notes yet.'}</Text>}
          <Flex mt="16px" gap="6px" wrap="wrap">
            {params.cursor && <ActionButton p="6px 9px" onClick={() => setSearch(filter ? { search: filter } : {})}>First page</ActionButton>}
            {notes.data.nextCursor && <ActionButton p="6px 9px" onClick={() => setSearch({ ...(filter ? { search: filter } : {}), after: notes.data.nextCursor! })}>Next page</ActionButton>}
          </Flex>
        </>}
      </Box>
      <Box minW="0" px={{ base: '22px', md: '44px' }} py={{ base: '28px', md: '40px' }}>
        <Box maxW="820px" mx="auto">
          {accessDenied ? <RequestState title="Unable to access notes" message={noteError(notes.error)} onRetry={() => { void notes.refetch() }} /> : noteId ? <NoteDocument key={noteId} space={space} id={noteId} editable={canWrite} /> : <Box pt={{ base: '30px', md: '100px' }}>
            <Box color="var(--accent-ink)" mb="20px"><NoteIcon /></Box>
            <Heading as="h1" fontSize="32px" fontWeight="500" letterSpacing="-.04em">A little room to think.</Heading>
            <Text color="var(--muted)" mt="14px" fontSize="14px" lineHeight="1.9">Choose a note from the sidebar{canWrite ? ', or start a new one.' : ' to start reading.'}<br />Your words, in one quiet place.</Text>
            {canWrite && <ActionButton mt="24px" onClick={() => setCreating(true)}>{notes.data?.objects.length ? 'Create a note' : 'Create your first note'}</ActionButton>}
          </Box>}
        </Box>
      </Box>
    </Box>
  </Box>
}
