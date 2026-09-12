import { Box, Flex, Heading, Text } from '@chakra-ui/react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { getGetOperationsStatusQueryKey, useGetOperationsStatus } from '../../api/generated/admin'
import { ActionButton } from '../../components/ui/Primitives'
import RequestState from '../../components/RequestState'
import { apiStatus } from '../../context/session'
import { formatFileSize } from '../SpacesPage/object/objectFileApi'

const messages = {
  'database-unavailable': 'The database is unavailable. Check the database container and connection settings.',
  'storage-unavailable': 'The content directory is missing or unavailable. Restore access before accepting writes.',
  'low-disk-space': 'Free disk space is below the configured reserve. Free space before accepting more data.',
  'recent-server-errors': 'Server errors occurred in the last 15 minutes. Review the summaries below and the server logs.',
}
const size = (bytes: number) => bytes >= 1024 ** 3
  ? (bytes / 1024 ** 3).toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' GiB' : formatFileSize(bytes)

export default function AdminSystem({ currentUserId }: { currentUserId: string }) {
  const client = useQueryClient()
  const query = useGetOperationsStatus({ query: {
    queryKey: [...getGetOperationsStatusQueryKey(), currentUserId], retry: false, refetchInterval: 30_000,
  } })
  useEffect(() => {
    if (query.isError && [401, 403].includes(apiStatus(query.error) ?? 0)) void client.invalidateQueries({ queryKey: ['session'] })
  }, [query.isError, query.error, client])
  if (query.isPending) return <RequestState loading title="Loading system status..." />
  if (query.isError) return <RequestState title="System status unavailable" message="Check deployment health and server logs, then try again." onRetry={() => { void query.refetch() }} />
  const status = query.data
  return <Box as="section" aria-label="System status" minW="0">
    <Flex justify="space-between" align="center" gap="16px" wrap="wrap">
      <Box><Heading as="h2" fontSize="18px" fontWeight="500">System checks</Heading><Text role="status" mt="6px" fontSize="13px" color={status.status === 'ok' ? 'var(--muted)' : 'fg.warning'}>{status.status === 'ok' ? 'Healthy' : 'Needs attention'}</Text></Box>
      <ActionButton loading={query.isFetching} onClick={() => { void query.refetch() }}>Refresh status</ActionButton>
    </Flex>
    <Text mt="12px" color="var(--muted)" fontSize="12px">Checked {new Date(status.checkedAt).toLocaleString('en-US')}. Updates automatically while open.</Text>
    {status.alerts.length > 0 && <Box role="alert" mt="20px" p="16px" bg="bg.warning" borderRadius="8px">
      {status.alerts.map(alert => <Text key={alert} fontSize="13px" lineHeight="1.8">{messages[alert]}</Text>)}
    </Box>}
    <Box display="grid" gridTemplateColumns={{ base: '1fr', sm: '1fr 1fr' }} gap="16px" mt="24px">
      {[
        ['Database', status.databaseReady ? 'Connected' : 'Unavailable', 'Read-only connection check'],
        ['Storage', status.storage.freeBytes === null ? 'Unavailable' : size(status.storage.freeBytes) + ' free', 'Configured reserve: ' + size(status.storage.minimumFreeBytes)],
        ['Git commands', `${status.git.active} / ${status.git.maximum} active`, 'Shared by transport, browsing and downloads'],
        ['Server errors', status.errors.total.toLocaleString('en-US'), 'Since this backend process started'],
      ].map(([title, value, detail]) => <Box key={title} p="20px" border="1px solid var(--border)" borderRadius="8px" minW="0">
        <Heading as="h3" fontSize="13px" fontWeight="500">{title}</Heading><Text mt="12px" fontSize="22px">{value}</Text><Text mt="6px" fontSize="12px" color="var(--muted)" overflowWrap="anywhere">{detail}</Text>
      </Box>)}
    </Box>
    <Text mt="16px" fontSize="12px" color="var(--muted)">Process started {new Date(status.startedAt).toLocaleString('en-US')}. Counters and summaries reset on restart.</Text>
    <Heading as="h3" mt="28px" fontSize="15px" fontWeight="500">Recent errors</Heading>
    <Text mt="8px" fontSize="12px" color="var(--muted)">Latest 20 summaries. Request details are omitted; use server logs to investigate.</Text>
    {!status.errors.recent.length ? <Text mt="16px" fontSize="13px" color="var(--muted)">No server errors recorded.</Text> : <Box as="ul" listStyleType="none" p="0" mt="16px" border="1px solid var(--border)" borderRadius="8px">
      {status.errors.recent.map((error, index) => <Box as="li" key={error.at + index} p="16px" _notFirst={{ borderTop: '1px solid var(--border)' }}>
        <Flex gap="12px" justify="space-between" wrap="wrap"><Text fontSize="13px">{error.kind === 'cleanup' ? 'Object cleanup' : error.kind === 'git' ? 'Git transport' : 'HTTP request'}{error.statusCode ? ' · ' + error.statusCode : ''}</Text><Text fontSize="12px" color="var(--muted)">{new Date(error.at).toLocaleString('en-US')}</Text></Flex>
        {error.route && <Text mt="6px" fontSize="12px" color="var(--muted)" overflowWrap="anywhere">{error.route}</Text>}
      </Box>)}
    </Box>}
  </Box>
}
