import { Box, Flex, Heading, Text } from '@chakra-ui/react'
import { useState } from 'react'
import type { GetSpace200 } from '../../../api/generated/api.schemas'
import { getListSpaceAppsQueryKey, useListSpaceApps } from '../../../api/generated/space-apps'
import { ActionButton, PageLink } from '../../../components/ui/Primitives'
import RequestState from '../../../components/RequestState'
import { useAuth } from '../../../context/auth'
import { appPath, appPlugins, getAppPlugin } from '../../AppPages/registry'
import { spaceErrorMessage } from '../shared/spaceApi'
import SpaceAppDialog, { type SpaceAppAction } from './SpaceAppDialog'

export default function SpaceApps({ account, space }: { account: string; space: GetSpace200 }) {
  const { user } = useAuth()
  const [action, setAction] = useState<SpaceAppAction | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const query = useListSpaceApps(account, space.slug, { query: {
    queryKey: [...getListSpaceAppsQueryKey(account, space.slug), user?.id ?? null],
    retry: false, gcTime: 0, staleTime: 0, refetchOnMount: 'always', refetchInterval: 30_000,
  } })
  const canManage = !query.isError && Boolean(user && query.data?.canManage)
  const hasCompatibleView = appPlugins.some(plugin => plugin.integration.storageType === space.type)
  // Discard a stale dialog immediately when refreshed permissions revoke access.
  if (!canManage && action) setAction(null)
  function open(next: SpaceAppAction) { setNotice(''); setError(''); setAction(next) }
  if (query.data && !query.isError && !query.data.apps.length && !hasCompatibleView) return null

  return <Box as="section" aria-label="Space apps" mb="32px" border="1px solid var(--border)" borderRadius="8px" p={{ base: '18px', md: '24px' }}>
    <Flex align="center" justify="space-between" gap="12px" mb="10px">
      <Heading as="h2" fontSize="18px" fontWeight="500">Apps</Heading>
      {canManage && hasCompatibleView && <ActionButton onClick={() => open({ kind: 'create' })}>New app</ActionButton>}
    </Flex>
    <Text color="var(--muted)" fontSize="13px" lineHeight="1.8" mb="18px">Different views of the same content. Files and access are managed by this Space.</Text>
    {notice && <Text role="status" mb="14px" fontSize="13px" color="fg.success">{notice}</Text>}
    {error && <Text role="alert" mb="14px" fontSize="13px" color="fg.error">{error}</Text>}
    {query.isPending ? <RequestState loading title="Loading apps..." /> : query.isError ? <RequestState title="Unable to load apps" message={spaceErrorMessage(query.error)} onRetry={() => { void query.refetch() }} /> : !query.data.apps.length ?
      <Text fontSize="13px" color="var(--muted)" py="14px">{canManage ? 'No apps yet. Create an app to open this content in a new view.' : 'No apps in this Space yet.'}</Text> :
      <Box as="ul" aria-label="Apps" listStyleType="none" m="0" p="0">
        {query.data.apps.map(instance => {
          const plugin = getAppPlugin(instance.appType)
          const available = plugin?.integration.storageType === space.type
          return <Box as="li" key={instance.id} aria-label={instance.name} py="16px" _notFirst={{ borderTop: '1px solid var(--border)' }}>
            <Flex align="center" justify="space-between" gap="14px" wrap="wrap">
              <Box minW="0" flex="1 1 160px"><Text fontSize="14px" fontWeight="500" overflowWrap="anywhere">{instance.name}</Text><Text color="var(--muted)" fontSize="12px" mt="4px">{plugin?.label ?? instance.appType}{!available && ' · App view unavailable on this site'}</Text></Box>
              <Flex gap="8px" wrap="wrap">
                {available && <ActionButton asChild><PageLink to={appPath(instance.appType, instance.id)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${instance.name} (opens in a new tab)`}>Open app<Text as="span" aria-hidden="true">↗</Text></PageLink></ActionButton>}
                {canManage && <><ActionButton aria-label={`Rename ${instance.name}`} onClick={() => open({ kind: 'rename', instance })}>Rename</ActionButton><ActionButton aria-label={`Remove ${instance.name}`} color="fg.error" onClick={() => open({ kind: 'remove', instance })}>Remove</ActionButton></>}
              </Flex>
            </Flex>
          </Box>
        })}
      </Box>}
    {action && canManage && <SpaceAppDialog account={account} space={space} action={action} onClose={() => setAction(null)} onSaved={message => { setAction(null); setNotice(message) }} onDenied={message => { setAction(null); setError(message) }} />}
  </Box>
}
