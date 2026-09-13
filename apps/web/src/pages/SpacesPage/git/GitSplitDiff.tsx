import { Box, Flex, Text } from '@chakra-ui/react'
import { useMemo } from 'react'
import { maxDiffPreviewLines, type DiffLine } from './gitHistoryApi'
import { splitDiffLines, type SplitDiffCell } from './splitDiff'

function Cell({ line, side }: { line?: SplitDiffCell; side: 'before' | 'after' }) {
  const color = line?.kind === 'removed' ? '#ef4444' : line?.kind === 'added' ? '#22c55e' : undefined
  return <Flex minW="0" bg={color ? `color-mix(in srgb, ${color} 14%, var(--background))` : !line ? 'var(--surface)' : undefined} borderRight={side === 'before' ? '1px solid var(--border)' : undefined}>
    <Text as="span" w="44px" flexShrink="0" textAlign="right" pr="8px" color="var(--muted)" userSelect="none" aria-hidden="true">{(side === 'before' ? line?.oldLine : line?.newLine) ?? ''}</Text>
    <Box minW="0" flex="1" pr="12px">
      <Box as="code" display="block" whiteSpace="pre-wrap" overflowWrap="anywhere" fontFamily="inherit" css={{ tabSize: 2 }}>{line?.text || '\u00a0'}</Box>
      {line?.noNewline && <Text fontSize="11px" color="var(--muted)">\ No newline at end of file</Text>}
    </Box>
  </Flex>
}

export default function GitSplitDiff({ lines }: { lines: DiffLine[] }) {
  const rows = useMemo(() => splitDiffLines(lines.slice(0, maxDiffPreviewLines)), [lines])
  return <Box role="region" aria-label="File diff" overflow="auto" maxH="640px" tabIndex={0} fontFamily="mono" fontSize="12px" lineHeight="1.8">
    <Box minW="600px">
      <Box display="grid" gridTemplateColumns="repeat(2, minmax(0, 1fr))" position="sticky" top="0" zIndex="1" bg="var(--surface)" borderBottom="1px solid var(--border)" fontFamily="body" fontWeight="500">
        <Text px="16px" py="6px" borderRight="1px solid var(--border)">Before</Text><Text px="16px" py="6px">After</Text>
      </Box>
      {rows.map((row, index) => row.meta !== undefined ? <Text key={index} px="16px" bg="var(--surface)" color="var(--muted)" whiteSpace="pre-wrap" overflowWrap="anywhere">{row.meta}</Text> : <Box key={index} display="grid" gridTemplateColumns="repeat(2, minmax(0, 1fr))">
        <Cell line={row.before} side="before" /><Cell line={row.after} side="after" />
      </Box>)}
    </Box>
  </Box>
}
