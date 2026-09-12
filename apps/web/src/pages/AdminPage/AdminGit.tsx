import { Box, Dialog, Flex, Heading, Portal, Text, chakra } from '@chakra-ui/react'
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getGetGitMaintenanceQueryKey, getListAdminGitSpacesQueryKey, startGitMaintenance, useGetGitMaintenance, useListAdminGitSpaces } from '../../api/generated/admin'
import type { ListAdminGitSpaces200SpacesItem } from '../../api/generated/api.schemas'
import RequestState from '../../components/RequestState'
import { ActionButton, PageLink, TextInput } from '../../components/ui/Primitives'
import { apiStatus } from '../../context/session'
import { formatFileSize } from '../SpacesPage/object/objectFileApi'

export default function AdminGit({ currentUserId }: { currentUserId: string }) {
  const client = useQueryClient()
  const [search, setSearch] = useState('')
  const [cursor, setCursor] = useState('')
  const [selected, setSelected] = useState<ListAdminGitSpaces200SpacesItem | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const cancel = useRef<HTMLButtonElement>(null)
  const params = { search, ...(cursor ? { cursor } : {}) }
  const spaces = useListAdminGitSpaces(params, { query: { queryKey: [...getListAdminGitSpacesQueryKey(params), currentUserId], retry: false } })
  const statusKey = [...getGetGitMaintenanceQueryKey(), currentUserId]
  const status = useGetGitMaintenance({ query: { queryKey: statusKey, retry: false, refetchInterval: 3000 } })
  useEffect(() => {
    if ([spaces.error, status.error].some(error => [401, 403].includes(apiStatus(error) ?? 0)))
      void client.invalidateQueries({ queryKey: ['session'] })
  }, [spaces.error, status.error, client])
  const job = status.data?.job
  const running = Boolean(job && job.phase !== 'finished')

  async function start() {
    if (!selected || pending || running) return
    setPending(true); setError('')
    try {
      const job = await startGitMaintenance({ spaceId: selected.id })
      client.setQueryData(statusKey, { job })
      setSelected(null)
      await client.invalidateQueries({ queryKey: statusKey })
    } catch (failure) {
      const code = apiStatus(failure)
      setError(code === 409 || code === 503 ? 'Storage or Git is busy. Wait for active operations to finish, then try again.'
        : code === 404 ? 'This Git Space no longer exists. Refresh the list.'
        : code === 401 || code === 403 ? 'Site administrator access is required.'
        : 'Unable to confirm maintenance started. Refresh the status before retrying.')
      if (code === 401 || code === 403) void client.invalidateQueries({ queryKey: ['session'] })
      void status.refetch()
    } finally { setPending(false) }
  }

  return <Box as="section" aria-label="Git maintenance" minW="0">
    <Flex justify="space-between" align="center" gap="12px" wrap="wrap">
      <Heading as="h2" fontSize="18px" fontWeight="500">Git maintenance</Heading>
      <ActionButton loading={status.isFetching || spaces.isFetching} onClick={() => { void status.refetch(); void spaces.refetch() }}>Refresh</ActionButton>
    </Flex>
    <Text mt="12px" fontSize="13px" lineHeight="1.8" color="var(--muted)">Compact a repository and clean up old, unreferenced objects. Integrity checks run before and after maintenance.</Text>
    {status.isPending ? <Text mt="16px" fontSize="13px">Loading maintenance status...</Text>
      : status.isError ? <Text role="alert" mt="16px" color="fg.error" fontSize="13px">Maintenance status is unavailable. Refresh before starting an operation.</Text>
      : job ? <Box mt="20px" p="20px" border="1px solid var(--border)" borderRadius="8px" aria-label="Maintenance result">
        <Text role="status" fontSize="14px" fontWeight="500">{job.phase !== 'finished' ? 'Maintenance in progress' : job.status === 'completed' ? 'Maintenance completed' : 'Maintenance failed'}</Text>
        <Text mt="6px" fontSize="13px" overflowWrap="anywhere">{job.repository}</Text>
        <Text mt="8px" fontSize="13px" lineHeight="1.8" color="var(--muted)">{job.message}</Text>
        {job.beforeBytes !== null && <Text mt="10px" fontSize="12px">Object storage: {formatFileSize(job.beforeBytes)}{job.afterBytes !== null ? ` → ${formatFileSize(job.afterBytes)}` : ''}</Text>}
        <Text mt="8px" fontSize="12px" color="var(--muted)">{job.finishedAt ? 'Finished' : 'Started'} {new Date(job.finishedAt ?? job.startedAt).toLocaleString('en-US')}</Text>
      </Box> : <Text mt="16px" fontSize="13px" color="var(--muted)">No maintenance has run since this server started.</Text>}
    <Box asChild mt="24px"><form onSubmit={event => { event.preventDefault(); setSearch(String(new FormData(event.currentTarget).get('search') ?? '').trim()); setCursor('') }}>
      <Flex gap="8px"><TextInput name="search" aria-label="Search Git Spaces" placeholder="Space or namespace" maxLength={100} /><ActionButton type="submit">Search</ActionButton></Flex>
    </form></Box>
    {spaces.isPending ? <RequestState loading title="Loading Git Spaces..." /> : spaces.isError ? <RequestState title="Git Spaces unavailable" onRetry={() => { void spaces.refetch() }} />
      : !spaces.data.spaces.length ? <Text mt="20px" fontSize="13px" color="var(--muted)">No Git Spaces found.</Text>
      : <Box as="ul" listStyleType="none" p="0" mt="16px" border="1px solid var(--border)" borderRadius="8px">
        {spaces.data.spaces.map(space => <Flex as="li" key={space.id} p="16px" align="center" justify="space-between" gap="16px" _notFirst={{ borderTop: '1px solid var(--border)' }}>
          <Box minW="0"><PageLink to={`/${space.namespace}/${space.slug}`} fontSize="14px" overflowWrap="anywhere">{space.name}</PageLink><Text mt="4px" fontSize="12px" color="var(--muted)" overflowWrap="anywhere">{space.namespace}/{space.slug}</Text></Box>
          <ActionButton flexShrink="0" disabled={running || pending || !status.isSuccess} aria-label={`Maintain ${space.namespace}/${space.slug}`} onClick={() => { setSelected(space); setError('') }}>Maintain</ActionButton>
        </Flex>)}
      </Box>}
    <Flex mt="16px" gap="8px">{cursor && <ActionButton onClick={() => setCursor('')}>First page</ActionButton>}{spaces.data?.nextCursor && <ActionButton onClick={() => setCursor(spaces.data!.nextCursor!)}>Next page</ActionButton>}</Flex>
    <Text mt="16px" fontSize="12px" color="var(--muted)" lineHeight="1.8">The latest result resets on server restart. Audit records persist across restarts. Run maintenance during a quiet period after verifying a backup.</Text>
    <Dialog.Root open={Boolean(selected)} onOpenChange={details => { if (!details.open && !pending) setSelected(null) }} initialFocusEl={() => cancel.current}>
      <Portal><Dialog.Backdrop /><Dialog.Positioner><Dialog.Content bg="var(--background)" color="var(--foreground)" mx="20px">
        <Dialog.Header><Dialog.Title>Maintain repository?</Dialog.Title></Dialog.Header>
        <Dialog.Body><Text fontSize="14px" overflowWrap="anywhere">{selected?.namespace}/{selected?.slug}</Text><Text mt="12px" fontSize="13px" lineHeight="1.8" color="var(--muted)">Storage writes pause for the whole job. Git browsing, clone and push also pause during compaction and verification. Unreferenced objects older than two weeks may be removed. The job continues if you leave this page.</Text>{error && <Text role="alert" mt="16px" color="fg.error" fontSize="13px">{error}</Text>}</Dialog.Body>
        <Dialog.Footer><ActionButton asChild disabled={pending}><chakra.button ref={cancel} onClick={() => setSelected(null)}>Cancel</chakra.button></ActionButton><ActionButton loading={pending} disabled={running || !status.isSuccess} onClick={() => { void start() }}>Start maintenance</ActionButton></Dialog.Footer>
      </Dialog.Content></Dialog.Positioner></Portal>
    </Dialog.Root>
  </Box>
}
