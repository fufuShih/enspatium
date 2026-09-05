import { Box, Flex, Heading, Text } from '@chakra-ui/react'
import { useState } from 'react'
import { ActionButton, EmptyState, PageLink, SelectInput, TextInput } from '../../components/ui/Primitives'
import { useSpaces } from '../../context/spaces'
import { sameNamespace } from '../UserPage/namespaces'
import type { Namespace } from '../UserPage/namespaces'
import { spacePath } from './spaceData'

export default function SpacesPage({ owner }: { owner: Namespace }) {
  const { spaces } = useSpaces()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All')
  const ownedSpaces = spaces.filter(space => sameNamespace(space.owner, owner))
  const visible = ownedSpaces.filter(space => (filter === 'All' || space.type === filter) && `${space.name} ${space.description}`.toLowerCase().includes(search.toLowerCase()))

  return (
    <Box minW="0">
      <Heading as="h2" fontSize="22px" fontWeight="600" mb="28px">Spaces</Heading>
      <Box as="section" aria-label="Space list">
        <Flex align="center" gap="12px" mb="24px">
          <TextInput flex="1" minW="0" type="search" aria-label="Search Spaces" placeholder="Search Spaces…" value={search} onChange={event => setSearch(event.target.value)} />
          <SelectInput width="auto" maxW="45%" aria-label="Filter by type" value={filter} onChange={event => setFilter(event.target.value)}>
            <option value="All">All types</option>
            <option value="Git">Git</option>
            <option value="Object">Object storage</option>
          </SelectInput>
        </Flex>
        <Box as="ul" listStyleType="none" p="0" m="0">
          {visible.map(space => (
            <Box as="li" key={space.id} borderTop="1px solid color-mix(in srgb, var(--border) 55%, transparent)" _last={{ borderBottom: '1px solid color-mix(in srgb, var(--border) 55%, transparent)' }}>
              <PageLink to={spacePath(space)} display="flex" alignItems={{ base: 'flex-start', md: 'center' }} flexDirection={{ base: 'column', md: 'row' }} justifyContent="space-between" gap={{ base: '10px', md: '24px' }} p={{ base: '18px 4px', md: '22px 8px' }} _hover={{ bg: 'var(--surface)' }}>
                <Box minW="0" width={{ base: '100%', md: 'auto' }}>
                  <Heading as="h2" fontSize="15px" fontWeight="600" overflowWrap="anywhere">{space.name}</Heading>
                  {space.description && <Text color="var(--muted)" fontSize="12px" mt="6px" truncate>{space.description}</Text>}
                </Box>
                <Flex gap="16px" color="var(--muted)" fontSize="11px" whiteSpace="nowrap">
                  <Text as="span">{space.type === 'Git' ? 'Git' : 'Object storage'}</Text>
                  <Text as="span">{space.visibility}</Text>
                </Flex>
              </PageLink>
            </Box>
          ))}
        </Box>
        {visible.length === 0 && (
          <EmptyState>
            <Heading as="h2" fontSize="16px" fontWeight="500" color="var(--foreground)" mb="10px">{ownedSpaces.length ? 'No matching Spaces' : 'No Spaces yet'}</Heading>
            {ownedSpaces.length > 0 && <ActionButton mt="20px" onClick={() => { setSearch(''); setFilter('All') }}>Clear filters</ActionButton>}
          </EmptyState>
        )}
      </Box>
    </Box>
  )
}
