import { Box, Dialog, Flex, Portal, Text, chakra } from '@chakra-ui/react'
import { useId, useRef, useState } from 'react'
import { ActionButton, PageLink, TextInput } from '../../../components/ui/Primitives'
import { objectFolderLocation } from './objectFolderApi'
import { objectMoveKey, objectParent, planObjectMoves, type MoveTarget } from './objectMoveApi'
import type { ObjectMoves } from './useObjectMoves'

export default function ObjectBatchMove({ moves, account, slug, prefix, disabled, onClear }: {
  moves: ObjectMoves; account: string; slug: string; prefix: string; disabled: boolean; onClear: () => void
}) {
  const locked = disabled || moves.busy || Boolean(moves.confirmation)
  const complete = moves.items.filter(item => item.status === 'moved').length
  const failed = moves.items.filter(item => item.status === 'failed').length
  const stopped = moves.items.filter(item => item.status === 'stopped').length
  const retryable = moves.items.some(item => item.retryable && (item.status === 'failed' || item.status === 'stopped'))
  const destination = moves.items[0] ? objectParent(moves.items[0].newKey) : ''
  const statusLabel = { queued: 'Waiting', moving: 'Moving', moved: 'Moved', failed: 'Failed', stopped: 'Stopped' }
  return <>
    {moves.items.length > 0 && <Box as="section" aria-label="Move results" mb="20px" border="1px solid var(--border)" borderRadius="8px" overflow="hidden">
      <Flex p="12px 16px" gap="12px" wrap="wrap" justify="space-between" align="center" bg="var(--surface)">
        <Text role="status" fontSize="13px">{complete} of {moves.items.length} files moved{failed ? ` · ${failed} failed` : ''}{stopped ? ` · ${stopped} stopped` : ''}</Text>
        <Flex gap="8px" wrap="wrap">
          {moves.busy ? <ActionButton onClick={moves.stop}>Stop moving</ActionButton> : <>
            {retryable && <ActionButton disabled={locked} onClick={() => moves.retry()}>Retry remaining moves</ActionButton>}
            <ActionButton onClick={moves.clear}>Dismiss move results</ActionButton>
          </>}
        </Flex>
      </Flex>
      {!moves.busy && complete > 0 && <Box px="16px" py="12px" borderTop="1px solid var(--border)"><PageLink fontSize="13px" textDecoration="underline" to={objectFolderLocation(account, slug, destination)}>Open destination folder</PageLink></Box>}
      <Box as="ul" m="0" p="0" listStyleType="none" maxH="260px" overflowY="auto">
        {moves.items.map(item => <Box as="li" key={item.id} p="12px 16px" borderTop="1px solid var(--border)">
          <Flex align="center" gap="12px" wrap="wrap">
            <Box flex="1" minW="120px"><Text fontSize="13px" overflowWrap="anywhere">{item.key}</Text>
              <Text mt="4px" fontSize="12px" color="var(--muted)" overflowWrap="anywhere">To: {item.newKey}</Text>
              {item.message && <Text mt="4px" fontSize="12px" lineHeight="1.7" color={item.status === 'failed' ? 'fg.error' : 'var(--muted)'} overflowWrap="anywhere">{item.message}</Text>}
            </Box>
            <Text fontSize="12px" color={item.status === 'failed' ? 'fg.error' : 'var(--muted)'}>{statusLabel[item.status]}</Text>
            {!moves.busy && item.retryable && (item.status === 'failed' || item.status === 'stopped') && <ActionButton p="5px 8px" disabled={locked} aria-label={`Retry moving ${item.key}`} onClick={() => moves.retry(item.id)}>Retry</ActionButton>}
          </Flex>
        </Box>)}
      </Box>
    </Box>}
    {moves.error && <Text role="alert" fontSize="13px" color="fg.error" mb="16px">{moves.error}</Text>}
    {moves.confirmation && <MoveConfirmation targets={moves.confirmation} prefix={prefix} disabled={disabled} onCancel={moves.cancel}
      onConfirm={folder => { if (moves.confirm(folder)) onClear() }} />}
  </>
}

function MoveConfirmation({ targets, prefix, disabled, onCancel, onConfirm }: {
  targets: MoveTarget[]; prefix: string; disabled: boolean; onCancel: () => void; onConfirm: (folder: string) => void
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [folder, setFolder] = useState(prefix)
  const plan = planObjectMoves(targets, folder)
  const invalid = targets.some(file => !objectMoveKey(file.key, 'move', folder))
  return <Dialog.Root open onOpenChange={event => { if (!event.open) onCancel() }} placement="center" initialFocusEl={() => input.current}>
    <Portal><Dialog.Backdrop /><Dialog.Positioner p="16px"><Dialog.Content bg="var(--background)" color="var(--foreground)" border="1px solid var(--border)" borderRadius="8px" maxW="520px" maxH="calc(100dvh - 32px)" overflowY="auto">
      <Box asChild><form onSubmit={event => { event.preventDefault(); if (plan && !disabled) onConfirm(folder) }}>
        <Dialog.Header><Dialog.Title fontSize="18px">Move {targets.length} {targets.length === 1 ? 'file' : 'files'}</Dialog.Title></Dialog.Header>
        <Dialog.Body>
          <Dialog.Description fontSize="13px" lineHeight="1.8" color="var(--muted)">Move files within this Space. Filenames and version history are kept. Links using the old paths will change. Existing files are never overwritten.</Dialog.Description>
          <chakra.label htmlFor={id} display="block" mt="16px" fontSize="13px">Destination folder</chakra.label>
          <TextInput id={id} ref={input} mt="8px" value={folder} maxLength={1024} onChange={event => setFolder(event.target.value)} />
          <Text mt="8px" fontSize="12px" color="var(--muted)" lineHeight="1.8">Relative to this Space, for example documents/books. Leave empty for All files. New folders are allowed.</Text>
          {!plan && <Text role={invalid ? 'alert' : undefined} mt="12px" fontSize="12px" color={invalid ? 'fg.error' : 'var(--muted)'}>{invalid ? 'Enter a valid folder path without reserved characters or parent directory segments.' : 'Choose a different folder for the selected files.'}</Text>}
          <Box as="ul" mt="16px" mb="0" p="0" listStyleType="none" maxH="200px" overflowY="auto">
            {targets.map(file => <Box as="li" key={file.id} py="8px" _notFirst={{ borderTop: '1px solid var(--border)' }}>
              <Text fontSize="13px" overflowWrap="anywhere">{file.key}</Text>
              <Text mt="4px" fontSize="12px" color="var(--muted)" overflowWrap="anywhere">To: {objectMoveKey(file.key, 'move', folder) ?? 'Invalid destination'}</Text>
            </Box>)}
          </Box>
        </Dialog.Body>
        <Dialog.Footer flexWrap="wrap"><ActionButton type="button" onClick={onCancel}>Cancel</ActionButton><ActionButton type="submit" disabled={disabled || !plan}>Confirm move</ActionButton></Dialog.Footer>
      </form></Box>
    </Dialog.Content></Dialog.Positioner></Portal>
  </Dialog.Root>
}
