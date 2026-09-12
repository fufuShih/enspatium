import { Box, Flex, Text, chakra } from '@chakra-ui/react'
import { useEffect, useId, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ListObjects200Item } from '../../api/generated/api.schemas'
import { moveObject } from '../../api/generated/objects'
import { ActionButton, TextInput } from '../../components/ui/Primitives'
import { apiCode, apiStatus } from '../../context/session'
import { fileErrorMessage, refreshObjectLists } from './objectFileApi'
import { objectMoveKey, objectParent } from './objectMoveApi'

export default function ObjectMoveForm({ account, slug, file, mode, onCancel, onMoved, onBusy }: {
  account: string; slug: string; file: ListObjects200Item; mode: 'rename' | 'move'
  onCancel: () => void; onMoved: (file: ListObjects200Item, warning: string) => void; onBusy: (busy: boolean) => void
}) {
  const id = useId()
  const client = useQueryClient()
  const operation = useRef<AbortController | null>(null)
  const [value, setValue] = useState(mode === 'rename' ? file.key.slice(file.key.lastIndexOf('/') + 1) : objectParent(file.key))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [needsReview, setNeedsReview] = useState(false)
  const target = objectMoveKey(file.key, mode, value)
  useEffect(() => () => operation.current?.abort(), [])

  async function save() {
    if (!target || target === file.key || operation.current || needsReview) return
    const controller = new AbortController()
    operation.current = controller; setBusy(true); onBusy(true); setError('')
    try {
      const moved = await moveObject(account, slug, { objectId: file.id, key: file.key, newKey: target, expectedVersion: file.versionId }, { signal: controller.signal })
      let warning = ''
      try { await refreshObjectLists(client, account, slug) }
      catch { warning = 'The file moved, but the list could not refresh. Reload to see the latest files.' }
      if (!controller.signal.aborted) onMoved(moved, warning)
    } catch (failure) {
      if (!controller.signal.aborted) {
        const changed = apiCode(failure) === 'OBJECT_MOVE_CONFLICT' || apiStatus(failure) === 404
        setNeedsReview(changed)
        setError(changed ? 'This file changed or moved. Close the preview and open it again.'
          : apiCode(failure) === 'OBJECT_KEY_CONFLICT' ? 'This name is used by a file, folder or deleted file. Choose another destination.'
          : fileErrorMessage(failure, 'move'))
        if (apiStatus(failure) === 401) void client.invalidateQueries({ queryKey: ['session'] })
      }
      // A lost response may hide a successful move. Keep the original request
      // preconditions so a retry can safely resolve that outcome on the server.
      await refreshObjectLists(client, account, slug).catch(() => {})
    } finally {
      if (!controller.signal.aborted) { setBusy(false); onBusy(false) }
      operation.current = null
    }
  }

  return <Box asChild><form onSubmit={event => { event.preventDefault(); void save() }}>
    <chakra.label htmlFor={id} fontSize="13px">{mode === 'rename' ? 'Filename' : 'Destination folder'}</chakra.label>
    <TextInput id={id} mt="8px" autoFocus value={value} maxLength={1024} disabled={busy} onChange={event => { setValue(event.target.value); if (!needsReview) setError('') }} />
    <Text fontSize="12px" color="var(--muted)" mt="8px" lineHeight="1.8">{mode === 'rename' ? 'Use a filename without slashes. The current folder is kept.' : 'Relative to this Space, for example documents/books. Leave empty for All files. New folders are allowed.'}</Text>
    {target ? <Text mt="16px" fontSize="13px" overflowWrap="anywhere">New path: {target}</Text> : <Text role="alert" mt="16px" fontSize="13px" color="fg.error">Enter a valid filename or folder path without reserved characters or parent directory segments.</Text>}
    <Text mt="8px" fontSize="12px" color="var(--muted)">Content and version history are kept. Links using the old path will change.</Text>
    {error && <Text role="alert" mt="16px" fontSize="13px" color="fg.error">{error}</Text>}
    <Flex mt="24px" gap="8px" justify="flex-end"><ActionButton type="button" disabled={busy} onClick={onCancel}>Cancel</ActionButton><ActionButton type="submit" loading={busy} loadingText="Saving..." disabled={!target || target === file.key || needsReview}>{mode === 'rename' ? 'Save name' : 'Move file'}</ActionButton></Flex>
  </form></Box>
}
