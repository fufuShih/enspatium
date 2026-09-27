import { Flex, Text } from '@chakra-ui/react'
import { useId, useState } from 'react'
import { TextInput } from '../../../../components/ui/Primitives'
import { parsePageNumber } from './pdfNavigation'

export default function PdfPageInput({ page, pageCount, onNavigate }: {
  page: number; pageCount: number; onNavigate: (page: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const errorId = useId()
  const reset = () => { setDraft(null); setInvalid(false) }
  return <Flex as="form" aria-label="Page navigation" align="center" gap="6px" mr="4px" position="relative"
    onSubmit={event => {
      event.preventDefault()
      const target = parsePageNumber(draft ?? String(page), pageCount)
      if (target === null) { setInvalid(true); return }
      reset()
      onNavigate(target)
    }}>
    <TextInput aria-label="Page number" title="Enter a page number and press Enter" type="text" inputMode="numeric" enterKeyHint="go"
      autoComplete="off" spellCheck={false} disabled={!pageCount} value={draft ?? String(page)}
      w={`${Math.max(42, String(pageCount).length * 8 + 14)}px`} minW="0" p="5px 6px" fontSize="12px" textAlign="center"
      aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined}
      onFocus={event => event.currentTarget.select()}
      onChange={event => { setDraft(event.target.value); setInvalid(false) }} onBlur={reset}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); reset(); event.currentTarget.blur() }
      }} />
    <Text as="span" fontSize="12px" color="var(--muted)">/ {pageCount || '…'}</Text>
    {invalid && <Text id={errorId} role="alert" position="absolute" top="calc(100% + 12px)" left="0" w="max-content" maxW="210px"
      whiteSpace="normal" fontSize="12px" p="8px 10px" bg="var(--surface)" border="1px solid var(--border)" borderRadius="4px" boxShadow="sm">
      Enter a whole page number from 1 to {pageCount}.
    </Text>}
  </Flex>
}
