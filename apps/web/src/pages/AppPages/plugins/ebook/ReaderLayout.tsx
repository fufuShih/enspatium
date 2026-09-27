import { Box, Flex, Heading, Text, chakra } from '@chakra-ui/react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ActionButton, PageLink } from '../../../../components/ui/Primitives'

export type ReaderBook = { title: string; libraryPath: string; source?: string }

export function ReaderHeader({ book, toggle }: { book: ReaderBook; toggle?: ReactNode }) {
  return <Flex as="header" aria-label="Reader header" align="center" flexShrink={0} gap="12px" wrap="wrap"
    px="12px" py="8px" borderBottom="1px solid var(--border)" bg="var(--surface)">
    <PageLink to={book.libraryPath} aria-label="Back to library" title="Back to library" fontSize="13px" flexShrink={0}>
      ←<Box as="span" display={{ base: 'none', md: 'inline' }} ml="8px">Back to library</Box>
    </PageLink>
    {toggle}
    <Heading as="h1" title={book.title} fontSize="14px" fontWeight="500" lineClamp={1} minW="0" flex="1">{book.title}</Heading>
    {book.source && <ActionButton asChild p="6px 10px" flexShrink={0}><chakra.a href={book.source} download={book.title} aria-label="Download book">Download</chakra.a></ActionButton>}
  </Flex>
}

export default function ReaderLayout({ book, navigationLabel, items = [], active, onNavigate, controls, children, renderSidebar, floatingAction }: {
  book: ReaderBook; navigationLabel: string; items?: { id: number; label: string }[]; active: number
  onNavigate: (id: number) => void; controls: ReactNode; children: ReactNode
  renderSidebar?: (navigate: (id: number) => void, open: boolean) => ReactNode
  floatingAction?: ReactNode
}) {
  const [open, setOpen] = useState(() => window.matchMedia('(min-width: 768px)').matches)
  const navigationId = useId()
  const sidebar = useRef<HTMLElement>(null)
  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)')
    const update = () => setOpen(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (renderSidebar) return
    const root = sidebar.current
    const selected = root?.querySelector<HTMLElement>('[aria-current]')
    if (root && selected) {
      const top = selected.offsetTop
      if (top < root.scrollTop) root.scrollTop = top
      else if (top + selected.offsetHeight > root.scrollTop + root.clientHeight) root.scrollTop = top + selected.offsetHeight - root.clientHeight
    }
  }, [active, open, renderSidebar])
  const navigate = (id: number) => {
    onNavigate(id)
    if (!window.matchMedia('(min-width: 768px)').matches) setOpen(false)
  }
  return <Flex direction="column" h="full" minH="0">
    <ReaderHeader book={book} toggle={<ActionButton aria-label="Toggle sidebar" title="Toggle sidebar"
      aria-expanded={open} aria-controls={navigationId} onClick={() => setOpen(value => !value)} p="6px" minW="30px" border="0">
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 4h14M3 10h14M3 16h14M7 4v12" /></svg>
    </ActionButton>} />
    <Flex flex="1" minH="0" minW="0" position="relative">
      <Box as="nav" ref={sidebar} id={navigationId} aria-label={navigationLabel} display={open ? 'block' : 'none'}
        position={{ base: 'absolute', md: 'relative' }} top="0" bottom="0" left="0" zIndex="3"
        w="220px" flexShrink={0} overflowY={renderSidebar ? 'hidden' : 'auto'} p={renderSidebar ? '0' : '12px 8px'} bg="var(--surface)" borderRight="1px solid var(--border)">
        {renderSidebar ? renderSidebar(navigate, open) : <>
        <Text color="var(--muted)" fontSize="11px" textTransform="uppercase" letterSpacing=".08em" px="10px" mb="10px">{navigationLabel}</Text>
        {items.map(item => <chakra.button key={item.id} type="button" display="block" w="full" textAlign="left"
          px="10px" py="8px" fontSize="13px" lineHeight="1.5" borderRadius="3px" cursor="pointer" overflowWrap="anywhere"
          bg={active === item.id ? 'var(--background)' : 'transparent'} color={active === item.id ? 'var(--accent-ink)' : 'var(--foreground)'}
          aria-current={active === item.id ? 'page' : undefined} _hover={{ bg: 'var(--background)' }}
          onClick={() => navigate(item.id)}>
          {item.label}
        </chakra.button>)}</>}
      </Box>
      <Box flex="1" minW="0" minH="0" overflow="hidden" position="relative">
        {floatingAction && <Box position="absolute" top="12px" left="12px" zIndex="2">{floatingAction}</Box>}
        <Flex role="toolbar" aria-label="Reading controls" position="absolute" top="12px"
          left={{ base: floatingAction ? 'auto' : '50%', md: '50%' }} right={{ base: floatingAction ? '12px' : 'auto', md: 'auto' }}
          transform={{ base: floatingAction ? 'none' : 'translateX(-50%)', md: 'translateX(-50%)' }}
          zIndex="2" align="center" gap="4px" px="8px" py="5px" borderRadius="6px" whiteSpace="nowrap"
          bg="color-mix(in srgb, var(--surface) 88%, transparent)" backdropFilter="blur(6px)"
          border="1px solid var(--border)" boxShadow="sm">{controls}</Flex>
        {children}
      </Box>
    </Flex>
  </Flex>
}
