import { Box, Dialog, Flex, Portal, Text, chakra } from '@chakra-ui/react'
import { useRef } from 'react'
import { ActionButton } from '../../../components/ui/Primitives'
import type { DeleteTarget } from './objectDeletion'
import type { ObjectDeletions } from './useObjectDeletions'

export function ObjectSelectionCheckbox({ label, checked, mixed = false, disabled, onChange }: {
  label: string; checked: boolean; mixed?: boolean; disabled: boolean; onChange: (checked: boolean) => void
}) {
  return <Box as="label" display="inline-flex" alignItems="center" justifyContent="center" minW="28px" minH="32px" flexShrink="0" cursor={disabled ? 'not-allowed' : 'pointer'}>
    <chakra.input type="checkbox" aria-label={label} checked={checked} disabled={disabled}
      ref={(element: HTMLInputElement | null) => { if (element) element.indeterminate = mixed }} onChange={event => onChange(event.target.checked)}
      w="16px" h="16px" accentColor="var(--foreground)" cursor="inherit" />
  </Box>
}

export default function ObjectBatchDelete({ deletions, selected, count, disabled, onSelectAll, onClear }: {
  deletions: ObjectDeletions; selected: DeleteTarget[]; count: number; disabled: boolean
  onSelectAll: (checked: boolean) => void; onClear: () => void
}) {
  const cancelButton = useRef<HTMLButtonElement>(null)
  const locked = disabled || deletions.busy || Boolean(deletions.confirmation)
  const complete = deletions.items.filter(item => item.status === 'deleted').length
  const failed = deletions.items.filter(item => item.status === 'failed').length
  const stopped = deletions.items.filter(item => item.status === 'stopped').length
  const retryable = deletions.items.some(item => item.retryable && (item.status === 'failed' || item.status === 'stopped'))
  const statusLabel = { queued: 'Waiting', deleting: 'Deleting', deleted: 'Deleted', failed: 'Failed', stopped: 'Stopped' }
  return <>
    {count > 0 && <Flex align="center" gap="8px" wrap="wrap" mb="12px" minH="40px">
      <ObjectSelectionCheckbox label="Select all files on this page" checked={selected.length === count} mixed={selected.length > 0 && selected.length < count} disabled={locked} onChange={onSelectAll} />
      <Text fontSize="12px" color="var(--muted)" flex="1">{selected.length ? `${selected.length} selected` : 'Select files'}</Text>
      {selected.length > 0 && <>
        <ActionButton disabled={locked} onClick={onClear}>Clear selection</ActionButton>
        <ActionButton disabled={locked} color="fg.error" onClick={() => deletions.ask(selected)}>Delete selected</ActionButton>
      </>}
    </Flex>}
    {deletions.items.length > 0 && <Box as="section" aria-label="Deletion results" mb="20px" border="1px solid var(--border)" borderRadius="8px" overflow="hidden">
      <Flex p="12px 16px" gap="12px" wrap="wrap" justify="space-between" align="center" bg="var(--surface)">
        <Text role="status" fontSize="13px">{complete} of {deletions.items.length} files deleted{failed ? ` · ${failed} failed` : ''}{stopped ? ` · ${stopped} stopped` : ''}</Text>
        <Flex gap="8px" wrap="wrap">
          {deletions.busy ? <ActionButton onClick={deletions.stop}>Stop deleting</ActionButton> : <>
            {retryable && <ActionButton disabled={disabled || Boolean(deletions.confirmation)} onClick={() => deletions.retry()}>Retry remaining</ActionButton>}
            <ActionButton onClick={deletions.clear}>Dismiss results</ActionButton>
          </>}
        </Flex>
      </Flex>
      <Box as="ul" m="0" p="0" listStyleType="none" maxH="260px" overflowY="auto">
        {deletions.items.map(item => <Box as="li" key={item.id} p="12px 16px" borderTop="1px solid var(--border)">
          <Flex align="center" gap="12px">
            <Box flex="1" minW="0"><Text fontSize="13px" overflowWrap="anywhere">{item.key}</Text>
              {item.message && <Text mt="4px" fontSize="12px" lineHeight="1.7" color={item.status === 'failed' ? 'fg.error' : 'var(--muted)'} overflowWrap="anywhere">{item.message}</Text>}
            </Box>
            <Text fontSize="12px" color={item.status === 'failed' ? 'fg.error' : 'var(--muted)'}>{statusLabel[item.status]}</Text>
            {!deletions.busy && item.retryable && (item.status === 'failed' || item.status === 'stopped') && <ActionButton p="5px 8px" disabled={locked} aria-label={`Retry deleting ${item.key}`} onClick={() => deletions.retry(item.id)}>Retry</ActionButton>}
          </Flex>
        </Box>)}
      </Box>
    </Box>}
    {deletions.error && <Text role="alert" fontSize="13px" color="fg.error" mb="16px">{deletions.error}</Text>}
    <Dialog.Root open={Boolean(deletions.confirmation)} onOpenChange={event => { if (!event.open) deletions.cancel() }} placement="center" initialFocusEl={() => cancelButton.current}>
      <Portal><Dialog.Backdrop /><Dialog.Positioner p="16px"><Dialog.Content bg="var(--background)" color="var(--foreground)" border="1px solid var(--border)" borderRadius="8px" maxW="480px" maxH="calc(100dvh - 32px)" overflowY="auto">
        <Dialog.Header><Dialog.Title fontSize="18px">Delete {deletions.confirmation?.length} {deletions.confirmation?.length === 1 ? 'file' : 'files'}?</Dialog.Title></Dialog.Header>
        <Dialog.Body>
          <Dialog.Description fontSize="13px" lineHeight="1.8" color="var(--muted)">Move these files to Deleted files? Content can be recovered until retention cleanup permanently removes it.</Dialog.Description>
          <Box as="ul" mt="16px" mb="0" pl="20px" maxH="200px" overflowY="auto" fontSize="13px" lineHeight="1.8">
            {deletions.confirmation?.map(file => <Box as="li" key={file.id} overflowWrap="anywhere">{file.key}</Box>)}
          </Box>
        </Dialog.Body>
        <Dialog.Footer flexWrap="wrap"><ActionButton asChild><chakra.button ref={cancelButton} onClick={deletions.cancel}>Cancel</chakra.button></ActionButton><ActionButton disabled={disabled} color="fg.error" onClick={() => { onClear(); deletions.confirm() }}>Confirm delete</ActionButton></Dialog.Footer>
      </Dialog.Content></Dialog.Positioner></Portal>
    </Dialog.Root>
  </>
}
