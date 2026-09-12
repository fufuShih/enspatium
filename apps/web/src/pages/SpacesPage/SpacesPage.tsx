import { Box, Flex, Heading, Text } from '@chakra-ui/react'
import { useState } from 'react'
import type { GetNamespace200, ListSpaces200Item } from '../../api/generated/api.schemas'
import RequestState from '../../components/RequestState'
import { ActionButton, PageLink, SelectInput, TextInput } from '../../components/ui/Primitives'
import { spaceErrorMessage, spacePath } from './shared/spaceApi'
import { appPlugins, getAppPlugin } from '../AppPages/registry'

export default function SpacesPage({ owner, spaces, isLoading, error, onRetry, signedIn, canCreate }: {
  owner: GetNamespace200
  spaces?: ListSpaces200Item[]
  isLoading: boolean
  error: unknown
  onRetry: () => void
  signedIn: boolean
  canCreate: boolean
}) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const visible = (spaces ?? []).filter(space => (filter === 'all' || (space.app ?? space.type) === filter) && `${space.name} ${space.slug}`.toLowerCase().includes(search.toLowerCase()))
  const createPath = `/space/create?${new URLSearchParams({ owner: owner.slug })}`

  return (
    <Box minW="0">
      <Flex align="center" justify="space-between" gap="16px" mb="28px">
        <Heading as="h2" fontSize="22px" fontWeight="600">Spaces</Heading>
        {canCreate && <ActionButton asChild><PageLink to={createPath}>Create Space</PageLink></ActionButton>}
      </Flex>
      {!signedIn ? <RequestState title="Sign in to view Spaces" message="Space lists are available to account members."><ActionButton asChild mt="20px"><PageLink to="/login" state={{ from: `/${owner.slug}` }}>Sign in</PageLink></ActionButton></RequestState>
        : isLoading ? <RequestState loading title="Loading Spaces..." />
          : error ? <RequestState title="Unable to load Spaces" message={spaceErrorMessage(error)} onRetry={onRetry} />
            : <Box as="section" aria-label="Space list">
              <Flex align="center" gap="12px" mb="24px">
                <TextInput flex="1" minW="0" type="search" aria-label="Search Spaces" placeholder="Search Spaces..." value={search} onChange={event => setSearch(event.target.value)} />
                <SelectInput width="auto" maxW="45%" aria-label="Filter by type" value={filter} onChange={event => setFilter(event.target.value)}>
                  <option value="all">All types</option><option value="git">Git</option><option value="object">Object storage</option>{appPlugins.map(plugin => <option key={plugin.type} value={plugin.type}>{plugin.label}</option>)}
                </SelectInput>
              </Flex>
              <Box as="ul" listStyleType="none" p="0" m="0">
                {visible.map(space => <Box as="li" key={space.id} borderTop="1px solid color-mix(in srgb, var(--border) 55%, transparent)" _last={{ borderBottom: '1px solid color-mix(in srgb, var(--border) 55%, transparent)' }}>
                  <PageLink to={spacePath(owner.slug, space.slug)} display="flex" alignItems={{ base: 'flex-start', md: 'center' }} flexDirection={{ base: 'column', md: 'row' }} justifyContent="space-between" gap={{ base: '10px', md: '24px' }} p={{ base: '18px 4px', md: '22px 8px' }} _hover={{ bg: 'var(--surface)' }}>
                    <Box minW="0"><Heading as="h3" fontSize="15px" fontWeight="600" overflowWrap="anywhere">{space.name}</Heading><Text color="var(--muted)" fontSize="12px" mt="6px" overflowWrap="anywhere">{space.slug}</Text></Box>
                    <Flex gap="16px" color="var(--muted)" fontSize="11px" whiteSpace="nowrap"><Text>{getAppPlugin(space.app)?.label ?? (space.type === 'git' ? 'Git' : 'Object storage')}</Text><Text>{space.visibility === 'public' ? 'Public' : 'Private'}</Text></Flex>
                  </PageLink>
                </Box>)}
              </Box>
              {visible.length === 0 && <RequestState title={spaces?.length ? 'No matching Spaces' : 'No Spaces yet'} message={spaces?.length ? 'Try another name or type.' : canCreate ? 'Create your first Space to get started.' : 'There are no Spaces available to you.'}>
                {Boolean(spaces?.length) && <ActionButton mt="20px" onClick={() => { setSearch(''); setFilter('all') }}>Clear filters</ActionButton>}
              </RequestState>}
            </Box>}
    </Box>
  )
}
