import { Badge, Box, Flex, Heading, Text, chakra } from '@chakra-ui/react'
import type { ListSpaces200Item } from '../../../api/generated/api.schemas'
import { PageLink } from '../../../components/ui/Primitives'
import { getAppPlugin } from '../../AppPages/registry'
import { gitRelativeTime } from '../git/gitTime'
import { spacePath } from './spaceApi'

export default function SpaceListItem({ account, space, now }: { account: string; space: ListSpaces200Item; now: number }) {
  const type = getAppPlugin(space.app)?.label ?? (space.type === 'git' ? 'Git' : 'Object storage')
  const icon = space.type === 'git'
    ? 'M5 3h14v17H5a2 2 0 0 1 0-4h14M5 3a2 2 0 0 0-2 2v13M7 20v3l2-1 2 1v-3'
    : space.app ? 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z'
    : 'M3 7V4h6l2 3h10v13H3V7Z'
  return <Box as="li" borderTop="1px solid color-mix(in srgb, var(--border) 55%, transparent)" _last={{ borderBottom: '1px solid color-mix(in srgb, var(--border) 55%, transparent)' }}>
    <PageLink to={spacePath(account, space.slug)} display="flex" alignItems="flex-start" justifyContent="space-between" gap="16px" px={{ base: '4px', md: '8px' }} py="16px" _hover={{ bg: 'var(--surface)' }}>
      <Flex gap="10px" minW="0" flex="1" align="flex-start">
        <Box color="var(--muted)" flexShrink="0" mt="2px" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={icon} /></svg></Box>
        <Box minW="0">
          <Flex align="center" gap="8px" wrap="wrap">
            <Heading as="h3" fontSize="15px" fontWeight="600" color="var(--accent-ink)" overflowWrap="anywhere">{space.name}</Heading>
            <Text fontSize="10px" lineHeight="1.5" color="var(--muted)" border="1px solid var(--border)" borderRadius="4px" px="5px" py="1px" flexShrink="0">{space.visibility === 'public' ? 'Public' : 'Private'}</Text>
          </Flex>
          <Text color="var(--muted)" fontSize="12px" mt="5px">Updated <chakra.time dateTime={space.updatedAt} title={new Date(space.updatedAt).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'long' })}>{gitRelativeTime(space.updatedAt, now)}</chakra.time></Text>
        </Box>
      </Flex>
      <Badge flexShrink="0" mt="2px" bg="var(--surface)" color="var(--muted)" border="1px solid var(--border)" borderRadius="full" px="8px" py="2px" fontSize="10px" fontWeight="500" whiteSpace="nowrap">{type}</Badge>
    </PageLink>
  </Box>
}
