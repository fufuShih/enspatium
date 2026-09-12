import { Box, Flex, Text } from '@chakra-ui/react'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getListObjectVersionsQueryKey, restoreObjectVersion, useListObjectVersions } from '../../../api/generated/objects'
import type { ListObjects200Item } from '../../../api/generated/api.schemas.ts'
import { useAuth } from '../../../context/auth'
import { apiStatus } from '../../../context/session'
import RequestState from '../../../components/RequestState'
import { ActionButton } from '../../../components/ui/Primitives'
import { fileErrorMessage, formatFileSize, refreshObjectLists } from './objectFileApi'

export default function ObjectVersions({ account, slug, fileKey, selectedId, onSelect, onRestored, onBusy }: {
  account: string; slug: string; fileKey: string; selectedId: string
  onSelect: (version: ListObjects200Item) => void; onRestored: () => void; onBusy: (busy: boolean) => void
}) {
  const { user } = useAuth()
  const client = useQueryClient()
  const [cursor, setCursor] = useState<number>()
  const [restoreId, setRestoreId] = useState<string>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const params = { key: fileKey, limit: 20, ...(cursor ? { cursor } : {}) }
  const history = useListObjectVersions(account, slug, params, { query: {
    retry: false, enabled: Boolean(user),
    queryKey: [...getListObjectVersionsQueryKey(account, slug, params), user?.id],
  } })
  async function restore() {
    if (!restoreId || !history.data || pending) return
    setPending(true); onBusy(true); setError('')
    try {
      await restoreObjectVersion(account, slug, { key: fileKey, versionId: restoreId, expectedVersion: history.data.object.versionId })
      await refreshObjectLists(client, account, slug)
      onRestored()
    } catch (failure) {
      setError(fileErrorMessage(failure, 'restore'))
      if (apiStatus(failure) === 401) void client.invalidateQueries({ queryKey: ['session'] })
      if (apiStatus(failure) === 409) void history.refetch()
    } finally { setPending(false); onBusy(false) }
  }
  if (history.isPending) return <RequestState loading title="Loading versions..." />
  if (history.isError) return <RequestState title="Unable to load versions" message={fileErrorMessage(history.error, 'list')} onRetry={() => { void history.refetch() }} />
  return <Box mt="20px" aria-label="Version history">
    <Text fontSize="12px" color="var(--muted)" mb="12px">Retention: up to {history.data.versionLimit} content versions; inactive versions expire after {history.data.retentionDays} days. Current content is always kept. Restoring creates a new version.</Text>
    {history.data.versions.map(version => <Flex key={version.versionId} gap="12px" align="center" wrap="wrap" py="12px" borderTop="1px solid var(--border)">
      <Box flex="1" minW="140px">
        <Text fontSize="13px">Version {version.revision}{version.versionId === history.data.object.versionId ? ' · Current' : ''}{version.isDeleted ? ' · Deleted' : ''}</Text>
        <Text fontSize="12px" color="var(--muted)">{new Date(version.createdAt).toLocaleString('en-US')} · {version.createdByName ?? 'Deleted user'}{version.isDeleted ? '' : ` · ${formatFileSize(version.sizeBytes)}`}</Text>
      </Box>
      {!version.isDeleted && <Flex gap="8px">
        <ActionButton aria-label={`Preview version ${version.revision}`} aria-pressed={selectedId === version.versionId} disabled={pending} onClick={() => onSelect(version)}>Preview</ActionButton>
        {version.versionId !== history.data.object.versionId && <ActionButton aria-label={`Restore version ${version.revision}`} disabled={pending} onClick={() => { setRestoreId(version.versionId); setError('') }}>Restore</ActionButton>}
      </Flex>}
    </Flex>)}
    {(cursor || history.data.nextCursor) && <Flex justify="flex-end" gap="8px" mt="12px">
      {cursor && <ActionButton disabled={pending} onClick={() => { setCursor(undefined); setRestoreId(undefined) }}>Latest versions</ActionButton>}
      {history.data.nextCursor && <ActionButton disabled={pending} onClick={() => { setCursor(history.data.nextCursor!); setRestoreId(undefined) }}>Older versions</ActionButton>}
    </Flex>}
    {restoreId && <Box mt="16px" p="12px" border="1px solid var(--border)" borderRadius="8px">
      <Text fontSize="13px">Restore this content as a new version? Older versions remain subject to retention settings.</Text>
      <Flex gap="8px" mt="12px"><ActionButton disabled={pending} onClick={() => setRestoreId(undefined)}>Cancel restore</ActionButton><ActionButton loading={pending} loadingText="Restoring..." onClick={() => { void restore() }}>Confirm restore</ActionButton></Flex>
    </Box>}
    {error && <Text role="alert" mt="12px" fontSize="13px" color="fg.error">{error}</Text>}
  </Box>
}
