import { Box, Flex, Text, chakra } from '@chakra-ui/react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { updateCurrentUser } from '../../api/generated/auth'
import { getGetNamespaceQueryKey, getListNamespacesQueryKey } from '../../api/generated/namespaces'
import { ActionButton, PageHeading, PageLink, TextInput } from '../../components/ui/Primitives'
import { useAuth } from '../../context/auth'
import { apiStatus, type AuthUser } from '../../context/session'
import { namespacePath } from '../UserPage/namespaces'

export default function ProfileSettings() {
  const { user } = useAuth()
  const client = useQueryClient()
  const [name, setName] = useState(user?.name || '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  if (!user) return null
  async function save(event: FormEvent) {
    event.preventDefault()
    if (request.current || !user) return
    if (!name.trim()) { setError('Please enter a display name.'); return }
    const controller = new AbortController()
    request.current = controller
    setPending(true); setError(''); setSaved(false)
    try {
      const profile = await updateCurrentUser({ displayName: name.trim() }, { signal: controller.signal })
      if (controller.signal.aborted) return
      await client.cancelQueries({ queryKey: ['session'] })
      client.setQueryData<AuthUser | null>(['session'], old => old?.id === profile.id ? { ...old, ...profile, name: profile.displayName, namespace: { ...old.namespace, name: profile.displayName } } : old)
      await Promise.all([
        client.invalidateQueries({ queryKey: getGetNamespaceQueryKey(user.namespace.account) }),
        client.invalidateQueries({ queryKey: getListNamespacesQueryKey() }),
      ])
      if (controller.signal.aborted) return
      setName(profile.displayName); setSaved(true)
    } catch (failure) {
      if (controller.signal.aborted) return
      setError(apiStatus(failure) === 400 ? 'Please enter a display name of 1 to 100 characters.' : 'Unable to save your profile. Please try again.')
      if (apiStatus(failure) === 401) await client.invalidateQueries({ queryKey: ['session'] })
    } finally {
      if (!controller.signal.aborted) { request.current = null; setPending(false) }
    }
  }
  return <Box as="section" aria-label="Personal profile">
    <PageHeading>Personal profile</PageHeading>
    <Text mt="10px" mb="28px" fontSize="14px" color="var(--muted)">Manage how your name appears on enspatium.</Text>
    <Flex align="center" gap="16px" mb="28px">
      <Flex boxSize="56px" flexShrink="0" align="center" justify="center" bg="var(--surface-strong)" borderRadius="full" fontSize="22px" aria-hidden="true">{Array.from(user.name)[0]?.toUpperCase()}</Flex>
      <Box minW="0"><Text fontSize="14px" fontWeight="500" overflowWrap="anywhere">{user.name}</Text><PageLink to={namespacePath(user.namespace)} fontSize="12px" color="var(--muted)">View profile</PageLink></Box>
    </Flex>
    <Box asChild><form onSubmit={save} aria-busy={pending}>
      <chakra.label htmlFor="profile-name" display="block" mb="8px" fontSize="13px">Display name</chakra.label>
      <TextInput id="profile-name" value={name} onChange={event => { setName(event.target.value); setSaved(false); setError('') }} required maxLength={100} autoComplete="name" disabled={pending} />
      <chakra.label htmlFor="profile-email" display="block" mt="24px" mb="8px" fontSize="13px">Email</chakra.label>
      <TextInput id="profile-email" value={user.email} readOnly bg="var(--surface)" />
      <Text mt="8px" fontSize="12px" color="var(--muted)">Your sign-in email. Email changes are not available yet.</Text>
      {error && <Text mt="20px" role="alert" fontSize="13px" color="fg.error">{error}</Text>}
      {saved && <Text mt="20px" role="status" fontSize="13px" color="var(--muted)">Profile saved.</Text>}
      <ActionButton mt="24px" type="submit" loading={pending} loadingText="Saving..." disabled={!name.trim() || name.trim() === user.name} bg="var(--foreground)" color="var(--background)">Save changes</ActionButton>
    </form></Box>
  </Box>
}
