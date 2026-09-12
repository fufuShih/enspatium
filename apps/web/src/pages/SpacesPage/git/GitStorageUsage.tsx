import { gitReadRetry } from './gitReadQuery'
import { Box, Text } from '@chakra-ui/react'
import { getGetGitSpaceStorageQueryKey, useGetGitSpaceStorage } from '../../../api/generated/spaces'
import { useAuth } from '../../../context/auth'
import { ActionButton } from '../../../components/ui/Primitives'
import { formatFileSize } from '../object/objectFileApi'

export default function GitStorageUsage({ account, slug }: { account: string; slug: string }) {
  const { user } = useAuth()
  const usage = useGetGitSpaceStorage(account, slug, { query: {
    queryKey: [...getGetGitSpaceStorageQueryKey(account, slug), user?.id ?? null], ...gitReadRetry, staleTime: 30_000,
  } })
  return <Box as="section" mt="24px" fontSize="12px" color="var(--muted)" aria-label="Repository storage">
    {usage.data ? <Text>
      Git objects: {formatFileSize(usage.data.usedBytes)} / {formatFileSize(usage.data.maxBytes)}
      {' · '}Push limit: {formatFileSize(usage.data.maxPushBytes)}
      {usage.data.usedBytes >= usage.data.maxBytes && ' · Storage limit reached. Contact the administrator.'}
    </Text> : usage.isError ? <Text>Storage usage unavailable.</Text> : <Text>Loading storage usage...</Text>}
    <ActionButton variant="ghost" size="xs" mt="4px" disabled={usage.isFetching} onClick={() => { void usage.refetch() }}>Refresh storage usage</ActionButton>
  </Box>
}
