import { Box, Flex, Heading } from '@chakra-ui/react'
import { useEffect, useState } from 'react'
import type { GetNamespace200, ListSpaces200Item } from '../../api/generated/api.schemas'
import RequestState from '../../components/RequestState'
import { ActionButton, PageLink, SelectInput, TextInput } from '../../components/ui/Primitives'
import { spaceErrorMessage } from './shared/spaceApi'
import { appPlugins } from '../AppPages/registry'
import SpaceListItem from './shared/SpaceListItem'

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
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer) }, [])
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
                {visible.map(space => <SpaceListItem key={space.id} account={owner.slug} space={space} now={now} />)}
              </Box>
              {visible.length === 0 && <RequestState title={spaces?.length ? 'No matching Spaces' : 'No Spaces yet'} message={spaces?.length ? 'Try another name or type.' : canCreate ? 'Create your first Space to get started.' : 'There are no Spaces available to you.'}>
                {Boolean(spaces?.length) && <ActionButton mt="20px" onClick={() => { setSearch(''); setFilter('all') }}>Clear filters</ActionButton>}
              </RequestState>}
            </Box>}
    </Box>
  )
}
