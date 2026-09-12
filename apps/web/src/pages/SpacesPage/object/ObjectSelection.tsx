import { Box, Flex, Text, chakra } from '@chakra-ui/react'
import { ActionButton } from '../../../components/ui/Primitives'

export function ObjectSelectionCheckbox({ label, checked, mixed = false, disabled, onChange }: {
  label: string; checked: boolean; mixed?: boolean; disabled: boolean; onChange: (checked: boolean) => void
}) {
  return <Box as="label" display="inline-flex" alignItems="center" justifyContent="center" minW="28px" minH="32px" flexShrink="0" cursor={disabled ? 'not-allowed' : 'pointer'}>
    <chakra.input type="checkbox" aria-label={label} checked={checked} disabled={disabled}
      ref={(element: HTMLInputElement | null) => { if (element) element.indeterminate = mixed }} onChange={event => onChange(event.target.checked)}
      w="16px" h="16px" accentColor="var(--foreground)" cursor="inherit" />
  </Box>
}

export default function ObjectSelection({ selectedCount, count, locked, onSelectAll, onClear, onDelete, onMove }: {
  selectedCount: number; count: number; locked: boolean
  onSelectAll: (checked: boolean) => void; onClear: () => void; onDelete: () => void; onMove: () => void
}) {
  return <>
    {count > 0 && <Flex align="center" gap="8px" wrap="wrap" mb="12px" minH="40px">
      <ObjectSelectionCheckbox label="Select all files on this page" checked={selectedCount === count} mixed={selectedCount > 0 && selectedCount < count} disabled={locked} onChange={onSelectAll} />
      <Text fontSize="12px" color="var(--muted)" flex="1">{selectedCount ? `${selectedCount} selected` : 'Select files'}</Text>
      {selectedCount > 0 && <>
        <ActionButton disabled={locked} onClick={onClear}>Clear selection</ActionButton>
        <ActionButton disabled={locked} onClick={onMove}>Move selected</ActionButton>
        <ActionButton disabled={locked} color="fg.error" onClick={() => onDelete()}>Delete selected</ActionButton>
      </>}
    </Flex>}
  </>
}
