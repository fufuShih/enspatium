import { Box, Flex, Heading, Text } from '@chakra-ui/react'
import { useMemo } from 'react'
import { PageLink } from '../../../components/ui/Primitives'
import RequestState from '../../../components/RequestState'
import { maxDiffPreviewLines, parseGitPatch } from './gitHistoryApi'

export default function GitDiffView({ patch, selectedPath, fileLocation, emptyMessage }: { patch: string; selectedPath?: string; fileLocation: (path: string) => string; emptyMessage: string }) {
  const files = useMemo(() => parseGitPatch(patch), [patch])
  const selected = selectedPath ? files.find(file => file.path === selectedPath) : files[0]
  if (!files.length) return <RequestState title="No file changes" message={emptyMessage} />
  return <>
    <Heading as="h3" fontSize="14px" fontWeight="500" mb="12px">{files.length} changed {files.length === 1 ? 'file' : 'files'}</Heading>
    <Box as="nav" aria-label="Changed files" border="1px solid var(--border)" borderRadius="8px" overflow="hidden" mb="20px" maxH="280px" overflowY="auto">
      {files.map((file, index) => <PageLink key={index} to={fileLocation(file.path)} display="flex" alignItems="center" justifyContent="space-between" gap="12px" p="12px 16px" borderTop={index ? '1px solid var(--border)' : undefined} bg={selected === file ? 'var(--surface)' : undefined} aria-current={selected === file ? 'page' : undefined} _hover={{ bg: 'var(--surface)' }}>
        <Text fontSize="13px" overflowWrap="anywhere">{file.status === 'Renamed' ? `${file.oldPath} → ${file.path}` : file.path}</Text>
        <Flex gap="12px" align="center" flexShrink="0" fontSize="12px"><Text color="var(--muted)">{file.status}</Text>{!file.binary && <Text fontFamily="mono">+{file.additions} −{file.deletions}</Text>}</Flex>
      </PageLink>)}
    </Box>
    {!selected ? <RequestState title="File not found in these changes" message="Choose a changed file above." /> : <Box border="1px solid var(--border)" borderRadius="8px" overflow="hidden">
      <Text px="16px" py="12px" fontSize="13px" borderBottom="1px solid var(--border)" overflowWrap="anywhere">{selected.path}</Text>
      {selected.binary ? <RequestState title="Binary file changed" message="Text differences are not available for this file." /> : <Box role="region" aria-label="File diff" overflowX="auto" maxH="640px" tabIndex={0} fontFamily="mono" fontSize="12px" lineHeight="1.8">
        <Box minW="max-content">
          {selected.lines.slice(0, maxDiffPreviewLines).map((line, index) => <Flex key={index} bg={line.kind === 'added' ? 'color-mix(in srgb, #22c55e 14%, var(--background))' : line.kind === 'removed' ? 'color-mix(in srgb, #ef4444 14%, var(--background))' : line.kind === 'meta' ? 'var(--surface)' : undefined}>
            <Text as="span" w="52px" flexShrink="0" textAlign="right" pr="8px" color="var(--muted)" userSelect="none" aria-hidden="true">{line.oldLine ?? ''}</Text>
            <Text as="span" w="52px" flexShrink="0" textAlign="right" pr="12px" color="var(--muted)" userSelect="none" aria-hidden="true">{line.newLine ?? ''}</Text>
            <Box as="code" display="block" whiteSpace="pre" pr="16px" fontFamily="inherit" css={{ tabSize: 2 }}>{line.text}</Box>
          </Flex>)}
        </Box>
      </Box>}
      {selected.lines.length > maxDiffPreviewLines && <Text p="16px" fontSize="12px" color="var(--muted)">Showing the first {maxDiffPreviewLines.toLocaleString('en-US')} diff lines. Clone the repository to view the full changes.</Text>}
    </Box>}
  </>
}
