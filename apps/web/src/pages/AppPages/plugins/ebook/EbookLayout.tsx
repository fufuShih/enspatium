import { Box, Flex, Text } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { ActionButton, PageLink } from '../../../../components/ui/Primitives'
import type { AppPageProps } from '../../types'

export function BookIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M12 5v15M3 4c4-1 7 0 9 2 2-2 5-3 9-2v15c-4-1-7 0-9 2-2-2-5-3-9-2V4Z" /></svg>
}

export default function EbookLayout({ space, basePath, onReload, children }: AppPageProps & { onReload: () => void; children: ReactNode }) {
  return <Box as="section" aria-label="Ebook library" minH="100dvh" bg="var(--background)" color="var(--foreground)" css={{ '& :is(button, a, input, select):focus-visible': { outline: '2px solid var(--accent-ink)', outlineOffset: '4px' } }}>
    <Flex maxW="1480px" mx="auto" gap="16px" align="center" px={{ base: '20px', md: '32px' }} py="22px" borderBottom="1px solid var(--border)">
      <PageLink to={basePath} display="flex" alignItems="center" gap="16px"><Box color="var(--accent-ink)"><BookIcon /></Box><Text fontWeight="600" fontSize="15px">Ebook library</Text></PageLink>
      <Text flex="1" minW="0" lineClamp={1} color="var(--muted)" fontSize="13px" display={{ base: 'none', sm: 'block' }}>{space.name}</Text>
      <ActionButton ml="auto" borderRadius="full" onClick={onReload}>Reload</ActionButton>
    </Flex>
    {children}
  </Box>
}
