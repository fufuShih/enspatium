import { Box, Flex, Heading, Text, chakra } from '@chakra-ui/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type FormEvent } from 'react'
import type { ListNamespaceMembers200Item, ListSpaceMembers200Item } from '../api/generated/api.schemas'
import { addNamespaceMember, getListNamespaceMembersQueryKey, listNamespaceMembers, removeNamespaceMember } from '../api/generated/namespaces'
import { addSpaceMember, getListSpaceMembersQueryKey, listSpaceMembers, removeSpaceMember, updateSpaceMember } from '../api/generated/spaces'
import { useAuth } from '../context/auth'
import { apiStatus } from '../context/session'
import { memberErrorMessage, refreshOrganization } from '../pages/UserPage/organizationApi'
import RequestState from './RequestState'
import { ActionButton, SelectInput, TextInput } from './ui/Primitives'

type Scope = { account: string; kind: 'organization' } | { account: string; kind: 'space'; slug: string }
type MemberRole = 'reader' | 'writer'

export default function MemberManager({ scope }: { scope: Scope }) {
  const { user } = useAuth()
  const client = useQueryClient()
  const organization = scope.kind === 'organization'
  const queryKey = organization ? getListNamespaceMembersQueryKey(scope.account) : getListSpaceMembersQueryKey(scope.account, scope.slug)
  const members = useQuery<(ListNamespaceMembers200Item | ListSpaceMembers200Item)[]>({
    queryKey: [...queryKey, user?.id ?? null],
    queryFn: ({ signal }) => organization ? listNamespaceMembers(scope.account, { signal }) : listSpaceMembers(scope.account, scope.slug, { signal }),
    enabled: Boolean(user), retry: false,
  })
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<MemberRole>('reader')
  const [pending, setPending] = useState(false)
  const busy = useRef(false)
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  async function run(action: () => Promise<unknown>, message: string, adding = false) {
    if (busy.current) return
    busy.current = true; setPending(true); setError(''); setStatus('')
    try {
      await action()
      if (adding) setEmail('')
      setConfirmation(null)
      await refreshOrganization(client, scope.account)
      setStatus(message)
    } catch (failure) {
      setError(memberErrorMessage(failure, organization, adding))
      if (apiStatus(failure) === 401) await client.invalidateQueries({ queryKey: ['session'] })
      if (apiStatus(failure) === 403 || apiStatus(failure) === 409) await members.refetch()
    } finally { busy.current = false; setPending(false) }
  }

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!email.trim()) return
    void run(() => organization ? addNamespaceMember(scope.account, { email: email.trim() }) : addSpaceMember(scope.account, scope.slug, { email: email.trim(), role }), 'Member added.', true)
  }

  if (members.isPending) return <RequestState loading title="Loading members..." />
  if (members.isError) return <RequestState title="Unable to load members" message={memberErrorMessage(members.error, organization)} onRetry={() => { void members.refetch() }} />

  return <Box as="section" aria-label={organization ? 'Organization members' : 'Space members'} minW="0">
    <Heading as="h2" fontSize="17px">Members</Heading>
    <Text mt="10px" mb="20px" color="var(--muted)" fontSize="13px" lineHeight="1.7">{organization ? 'Add a registered user by email. Give them access to individual Spaces in Space settings.' : 'Add someone who already belongs to this organization. Readers can view and download; writers can also push and manage files.'}</Text>
    <form onSubmit={add}>
      <chakra.fieldset disabled={pending} border="0" p="0" m="0" minW="0">
        <Flex gap="12px" align="flex-end" wrap="wrap">
          <Box flex="1" minW="180px"><chakra.label htmlFor="member-email" display="block" mb="8px" fontSize="13px">Member email</chakra.label><TextInput id="member-email" type="email" autoComplete="off" required maxLength={320} placeholder="teammate@example.com" value={email} onChange={event => { setEmail(event.target.value); setError(''); setStatus('') }} /></Box>
          {!organization && <Box w="110px"><chakra.label htmlFor="member-role" display="block" mb="8px" fontSize="13px">Role</chakra.label><SelectInput id="member-role" value={role} onChange={event => setRole(event.target.value as MemberRole)}><option value="reader">Reader</option><option value="writer">Writer</option></SelectInput></Box>}
          <ActionButton type="submit" disabled={pending || !email.trim()}>Add member</ActionButton>
        </Flex>
      </chakra.fieldset>
    </form>
    {error && <Text role="alert" color="fg.error" fontSize="13px" mt="16px">{error}</Text>}
    <Text role="status" aria-live="polite" color="var(--muted)" fontSize="13px" mt={status ? '16px' : '0'}>{pending ? 'Updating members...' : status}</Text>
    <Box as="ul" listStyleType="none" p="0" m="0" mt="24px">
      {members.data.map(member => <Box as="li" key={member.userId} borderTop="1px solid var(--border)" py="18px">
        <Flex align="center" gap="14px" wrap="wrap">
          <Box flex="1" minW="160px"><Text fontSize="14px" fontWeight="500" overflowWrap="anywhere">{member.displayName}</Text><Text fontSize="12px" mt="4px" color="var(--muted)" overflowWrap="anywhere">{member.email}</Text></Box>
          {member.role === 'owner' ? <Text fontSize="12px" color="var(--muted)">Owner</Text> : <>
            {!organization ? <SelectInput w="110px" aria-label={'Role for ' + member.email} disabled={pending} value={member.role} onChange={event => { const nextRole = event.target.value as MemberRole; void run(() => updateSpaceMember(scope.account, scope.slug, member.userId, { role: nextRole }), 'Role updated.') }}><option value="reader">Reader</option><option value="writer">Writer</option></SelectInput> : <Text fontSize="12px" color="var(--muted)">Member</Text>}
            <ActionButton type="button" disabled={pending} aria-label={'Remove ' + member.email} onClick={() => { setConfirmation(member.userId); setError(''); setStatus('') }}>Remove</ActionButton>
          </>}
        </Flex>
        {confirmation === member.userId && <Box mt="16px" bg="var(--surface)" p="16px" borderRadius="8px">
          <Text fontSize="13px" lineHeight="1.7">{organization ? 'Remove this member from the organization and all its Spaces? They can still view public Spaces.' : 'Remove this member’s access to this Space? They can still view it if it is public.'}</Text>
          <Flex justify="flex-end" gap="10px" mt="14px"><ActionButton type="button" disabled={pending} onClick={() => setConfirmation(null)}>Cancel</ActionButton><ActionButton type="button" color="fg.error" disabled={pending} onClick={() => { void run(() => organization ? removeNamespaceMember(scope.account, member.userId) : removeSpaceMember(scope.account, scope.slug, member.userId), 'Member removed.') }}>Remove member</ActionButton></Flex>
        </Box>}
      </Box>)}
    </Box>
  </Box>
}
