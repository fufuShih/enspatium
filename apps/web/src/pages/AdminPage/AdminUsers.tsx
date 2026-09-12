import { Box, Dialog, Flex, Heading, Portal, Text, chakra } from '@chakra-ui/react'
import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createAdminManagedUser, getListAdminUsersQueryKey, setUserAccess, useListAdminUsers } from '../../api/generated/admin'
import type { ListAdminUsers200UsersItem } from '../../api/generated/api.schemas'
import { ActionButton, TextInput } from '../../components/ui/Primitives'
import RequestState from '../../components/RequestState'
import { apiStatus } from '../../context/session'

export default function AdminUsers({ currentUserId }: { currentUserId: string }) {
  const client = useQueryClient()
  const [search, setSearch] = useState('')
  const [cursor, setCursor] = useState('')
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<ListAdminUsers200UsersItem | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const cancel = useRef<HTMLButtonElement>(null)
  const users = useListAdminUsers({ search, ...(cursor ? { cursor } : {}) }, { query: { retry: false } })

  async function save(operation: () => Promise<unknown>, message: string) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      await operation()
      setSelected(null); setCreating(false); setNotice(message)
      await client.invalidateQueries({ queryKey: getListAdminUsersQueryKey() })
    } catch (failure) {
      const status = apiStatus(failure)
      setError(status === 401 || status === 403 ? 'Site administrator access is required.'
        : status === 409 ? 'This account already exists, or the requested change is not allowed.'
        : status === 400 ? 'Check the account details and try again.' : 'Unable to save the account. Refresh the list before trying again.')
      if (status === 401 || status === 403) void client.invalidateQueries({ queryKey: ['session'] })
    } finally { setBusy(false) }
  }

  return <Box as="section" aria-label="User management">
    <Flex align="center" justify="space-between" gap="12px" mb="16px"><Heading as="h2" fontSize="18px">Users</Heading><ActionButton disabled={busy} onClick={() => { setCreating(value => !value); setError(''); setNotice('') }}>Create user</ActionButton></Flex>
    <Text mb="20px" fontSize="13px" color="var(--muted)" lineHeight="1.8">Create accounts for invited users. Disabling an account blocks sign-in and revokes existing sessions and access tokens. Space contents are kept.</Text>
    {creating && <Box asChild p="20px" border="1px solid var(--border)" borderRadius="8px" mb="20px"><form aria-label="Create user" onSubmit={event => {
      event.preventDefault()
      const form = event.currentTarget
      const data = new FormData(form)
      const body = { displayName: String(data.get('displayName')), email: String(data.get('email')), password: String(data.get('password')) }
      void save(() => createAdminManagedUser(body), 'Account created. Share its credentials privately with the user.')
      ;(form.elements.namedItem('password') as HTMLInputElement).value = ''
    }}>
      <chakra.fieldset disabled={busy} border="0" p="0" m="0" minW="0">
        <chakra.label display="block" fontSize="13px" htmlFor="admin-user-name">Name</chakra.label><TextInput id="admin-user-name" name="displayName" mt="8px" mb="16px" maxLength={100} required autoComplete="off" />
        <chakra.label display="block" fontSize="13px" htmlFor="admin-user-email">Email</chakra.label><TextInput id="admin-user-email" name="email" type="email" mt="8px" mb="16px" maxLength={320} required autoComplete="off" />
        <chakra.label display="block" fontSize="13px" htmlFor="admin-user-password">Password</chakra.label><TextInput id="admin-user-password" name="password" type="password" mt="8px" minLength={8} maxLength={1024} required autoComplete="new-password" />
        <Flex gap="8px" justify="flex-end" mt="20px"><ActionButton type="button" onClick={() => setCreating(false)}>Cancel</ActionButton><ActionButton type="submit" loading={busy}>Save user</ActionButton></Flex>
      </chakra.fieldset>
    </form></Box>}
    <Flex asChild gap="8px" mb="20px"><form onSubmit={event => { event.preventDefault(); setSearch(String(new FormData(event.currentTarget).get('search') ?? '')); setCursor('') }}>
      <TextInput name="search" aria-label="Search users" placeholder="Name or email" maxLength={100} /><ActionButton type="submit" disabled={busy}>Search</ActionButton>
    </form></Flex>
    {notice && <Text role="status" mb="16px" fontSize="13px" color="fg.success">{notice}</Text>}
    {error && <Text role="alert" mb="16px" fontSize="13px" color="fg.error">{error}</Text>}
    {users.isPending ? <RequestState loading title="Loading users..." /> : users.isError ? <RequestState title="Unable to load users" onRetry={() => { void users.refetch() }} /> : <>
      {!users.data.users.length ? <RequestState title="No matching users" /> : <Box as="ul" listStyleType="none" m="0" p="0" border="1px solid var(--border)" borderRadius="8px">
        {users.data.users.map(user => <Box as="li" key={user.id} p="16px" _notFirst={{ borderTop: '1px solid var(--border)' }}>
          <Flex gap="12px" align="center" wrap="wrap">
            <Box flex="1" minW="140px"><Text fontSize="14px" overflowWrap="anywhere">{user.displayName}{user.isAdmin ? ' · Admin' : ''}</Text><Text mt="4px" fontSize="12px" color="var(--muted)" overflowWrap="anywhere">{user.email}</Text></Box>
            <Text fontSize="12px" color="var(--muted)">{user.isDisabled ? 'Disabled' : 'Active'}</Text>
            <ActionButton disabled={busy || user.id === currentUserId} aria-label={`${user.isDisabled ? 'Enable' : 'Disable'} ${user.email}`} onClick={() => { setSelected(user); setError('') }}>{user.isDisabled ? 'Enable' : 'Disable'}</ActionButton>
          </Flex>
        </Box>)}
      </Box>}
      <Flex mt="16px" gap="8px" justify="flex-end">{cursor && <ActionButton disabled={busy} onClick={() => setCursor('')}>First page</ActionButton>}{users.data.nextCursor && <ActionButton disabled={busy} onClick={() => setCursor(users.data.nextCursor!)}>Next page</ActionButton>}</Flex>
    </>}
    <Dialog.Root open={Boolean(selected)} onOpenChange={event => { if (!event.open && !busy) setSelected(null) }} placement="center" initialFocusEl={() => cancel.current}>
      <Portal><Dialog.Backdrop /><Dialog.Positioner p="16px"><Dialog.Content maxW="440px" bg="var(--background)" color="var(--foreground)" border="1px solid var(--border)" borderRadius="8px">
        <Dialog.Header><Dialog.Title>{selected?.isDisabled ? 'Enable account?' : 'Disable account?'}</Dialog.Title></Dialog.Header>
        <Dialog.Body><Text fontSize="13px" overflowWrap="anywhere" mb="12px">{selected?.email}</Text><Dialog.Description fontSize="13px" color="var(--muted)" lineHeight="1.8">{selected?.isDisabled ? 'The user can sign in again. Revoked sessions and access tokens stay invalid.' : 'The user will lose access on subsequent requests. Existing transfers may finish. Files and repositories will be kept.'}</Dialog.Description>{error && <Text role="alert" mt="12px" fontSize="13px" color="fg.error">{error}</Text>}</Dialog.Body>
        <Dialog.Footer><ActionButton asChild disabled={busy}><chakra.button ref={cancel} onClick={() => setSelected(null)}>Cancel</chakra.button></ActionButton><ActionButton loading={busy} onClick={() => { if (selected) void save(() => setUserAccess(selected.id, { disabled: !selected.isDisabled }), selected.isDisabled ? 'Account enabled.' : 'Account disabled. Sessions and access tokens were revoked.') }}>Confirm {selected?.isDisabled ? 'enable' : 'disable'}</ActionButton></Dialog.Footer>
      </Dialog.Content></Dialog.Positioner></Portal>
    </Dialog.Root>
  </Box>
}
