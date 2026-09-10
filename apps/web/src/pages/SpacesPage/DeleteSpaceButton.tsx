import { Box, Dialog, Flex, Portal, Text, chakra } from '@chakra-ui/react'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { deleteSpace } from '../../api/generated/spaces'
import { ActionButton, TextInput } from '../../components/ui/Primitives'
import { apiStatus } from '../../context/session'
import { namespacePath } from '../UserPage/namespaces'
import { storageErrorMessage } from './storageErrors'
import { clearDeletedSpace } from './spaceApi'

export default function DeleteSpaceButton({ account, slug }: { account: string; slug: string }) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function handleDelete() {
    if (pending || confirmation !== slug) return
    setPending(true); setError('')
    try {
      await deleteSpace(account, slug)
      await clearDeletedSpace(client, account, slug)
      navigate(namespacePath({ account }), { replace: true })
    } catch (failure) {
      setError(storageErrorMessage(failure) ?? (apiStatus(failure) === 403 ? 'Only a Space owner can delete this Space.' : apiStatus(failure) === 401 ? 'Please sign in again before deleting this Space.' : 'Unable to delete this Space. Please try again.'))
      if (apiStatus(failure) === 401) await client.invalidateQueries({ queryKey: ['session'] })
    } finally { setPending(false) }
  }

  return <Dialog.Root open={open} onOpenChange={details => { if (!pending) { setOpen(details.open); setConfirmation(''); setError('') } }} placement="center" role="alertdialog" closeOnEscape={!pending} closeOnInteractOutside={!pending}>
    <Dialog.Trigger asChild><ActionButton color="fg.error">Delete Space</ActionButton></Dialog.Trigger>
    <Portal><Dialog.Backdrop /><Dialog.Positioner p="20px"><Dialog.Content w="100%" maxW="480px" bg="var(--background)" color="var(--foreground)" border="1px solid var(--border)" borderRadius="12px" p="24px">
      <Dialog.Title fontSize="20px">Delete Space</Dialog.Title>
      <Dialog.Description mt="12px" fontSize="13px" lineHeight="1.8">This permanently deletes this Space, all file versions including deleted files, its Git history, and its member access. This cannot be undone.</Dialog.Description>
      <Text mt="12px" fontSize="13px" color="var(--muted)">If the Space directory is already missing, its records can still be removed once the storage root is available.</Text>
      <Box asChild mt="20px"><form onSubmit={event => { event.preventDefault(); void handleDelete() }}>
        <chakra.label htmlFor="delete-space-confirmation" display="block" fontSize="13px" mb="8px" overflowWrap="anywhere">Type {slug} to confirm</chakra.label>
        <TextInput id="delete-space-confirmation" autoComplete="off" value={confirmation} disabled={pending} onChange={event => setConfirmation(event.target.value)} />
        {error && <Text role="alert" mt="16px" fontSize="13px" color="fg.error">{error}</Text>}
        <Flex gap="12px" justify="flex-end" mt="24px"><Dialog.CloseTrigger asChild position="static"><ActionButton type="button" disabled={pending}>Cancel</ActionButton></Dialog.CloseTrigger><ActionButton type="submit" color="fg.error" disabled={confirmation !== slug || pending} loading={pending} loadingText="Deleting...">Delete permanently</ActionButton></Flex>
      </form></Box>
    </Dialog.Content></Dialog.Positioner></Portal>
  </Dialog.Root>
}
