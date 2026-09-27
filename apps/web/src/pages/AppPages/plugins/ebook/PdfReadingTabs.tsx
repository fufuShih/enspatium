import { Box, Flex, Popover, Portal, Text, chakra } from '@chakra-ui/react'
import { useEffect, useState } from 'react'
import { ActionButton } from '../../../../components/ui/Primitives'
import type { ReadingTab } from './pdfReadingPosition'

export default function PdfReadingTabs({ tabs, active, pageCount, disabled, onAdd, onSelect, onClose }: {
  tabs: ReadingTab[]; active: number; pageCount: number; disabled: boolean
  onAdd: () => void; onSelect: (id: number) => void; onClose: (id: number) => void
}) {
  const [open, setOpen] = useState(false)
  // The portal mounts after the trigger updates; focus only once the list exists.
  const [list, setList] = useState<HTMLUListElement | null>(null)
  useEffect(() => {
    if (!open) return
    const root = list
    const selected = root?.querySelector<HTMLButtonElement>('[aria-current="true"]')
    if (!root || !selected) return
    selected.focus({ preventScroll: true })
    const row = selected.parentElement!
    if (row.offsetTop < root.scrollTop) root.scrollTo({ top: row.offsetTop })
    else if (row.offsetTop + row.offsetHeight > root.scrollTop + root.clientHeight) root.scrollTo({ top: row.offsetTop + row.offsetHeight - root.clientHeight })
  }, [open, active, tabs.length, list])

  return <Popover.Root open={open} onOpenChange={details => setOpen(details.open)} lazyMount unmountOnExit
    positioning={{ placement: 'bottom-start', gutter: 8, strategy: 'fixed' }}
    initialFocusEl={() => list?.querySelector<HTMLButtonElement>('[aria-current="true"]') ?? null}>
    <Popover.Trigger asChild>
      <ActionButton aria-label="Reading tabs" title={`Reading tabs (${tabs.length})`} disabled={disabled}
        w="44px" h="44px" minW="44px" p="0" borderRadius="full" boxShadow="sm"
        bg="color-mix(in srgb, var(--surface) 88%, transparent)" backdropFilter="blur(6px)">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M7 7V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-3" />
          <rect x="3" y="7" width="14" height="14" rx="1.5" />
        </svg>
      </ActionButton>
    </Popover.Trigger>
    <Portal>
      <Popover.Positioner>
        <Popover.Content aria-label="Reading tabs" display="flex" flexDirection="column" w="280px" maxW="calc(100vw - 24px)" maxH="min(480px, calc(100dvh - 132px))"
          bg="var(--surface)" color="var(--foreground)" border="1px solid var(--border)" borderRadius="8px" boxShadow="lg"
          overflow="hidden" css={{ '& button:focus-visible': { outline: '2px solid var(--accent-ink)', outlineOffset: '-2px' } }}>
          <Popover.Title px="14px" py="12px" fontSize="13px" fontWeight="600" borderBottom="1px solid var(--border)" flexShrink={0}>Reading tabs</Popover.Title>
          <Box as="ul" ref={setList} aria-label="PDF reading tabs" listStyleType="none" m="0" p="6px" minH="0" overflowY="auto" overscrollBehavior="contain" position="relative">
            {tabs.map((tab, index) => <Flex as="li" key={tab.id} align="center" borderRadius="4px"
              bg={active === tab.id ? 'var(--background)' : 'transparent'}>
              <chakra.button type="button" aria-label={`Reading tab ${tab.id}, page ${tab.page}`} aria-current={active === tab.id ? 'true' : undefined}
                textAlign="left" flex="1" minW="0" px="10px" py="10px" cursor="pointer" borderRadius="4px"
                _hover={{ bg: 'var(--background)' }} onClick={() => { onSelect(tab.id); setOpen(false) }}
                onKeyDown={event => {
                  if (event.key === 'Delete' && tabs.length > 1) { event.preventDefault(); onClose(tab.id); return }
                  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
                    : event.key === 'ArrowDown' ? (index + 1) % tabs.length
                    : event.key === 'ArrowUp' ? (index + tabs.length - 1) % tabs.length : null
                  if (next !== null) {
                    event.preventDefault()
                    list?.querySelectorAll<HTMLButtonElement>('[data-reading-tab]')[next]?.focus()
                  }
                }} data-reading-tab={tab.id}>
                <Text as="span" display="block" fontSize="13px" fontWeight={active === tab.id ? '600' : '500'}>Tab {tab.id}</Text>
                <Text as="span" display="block" fontSize="12px" color="var(--muted)" mt="2px">Page {tab.page} of {pageCount}</Text>
              </chakra.button>
              {tabs.length > 1 && <chakra.button type="button" aria-label={`Close reading tab ${tab.id}`} title="Close tab"
                w="36px" h="36px" flexShrink={0} mr="4px" fontSize="18px" borderRadius="4px" cursor="pointer"
                color="var(--muted)" _hover={{ bg: 'var(--background)', color: 'var(--foreground)' }} onClick={() => onClose(tab.id)}>×</chakra.button>}
            </Flex>)}
          </Box>
          <Box p="8px" borderTop="1px solid var(--border)" flexShrink={0}>
            <ActionButton aria-label="New reading tab" w="full" onClick={() => { onAdd(); setOpen(false) }} p="8px 12px">+ New tab</ActionButton>
          </Box>
        </Popover.Content>
      </Popover.Positioner>
    </Portal>
  </Popover.Root>
}
