import { Box, Flex, Text, chakra } from '@chakra-ui/react'
import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { createOrganizationNamespace } from '../../api/generated/namespaces'
import AuthStatus from '../../components/AuthStatus'
import { ActionButton, PageContainer, PageHeading, TextInput } from '../../components/ui/Primitives'
import { useAuth } from '../../context/auth'
import { apiStatus } from '../../context/session'
import { makeSpaceSlug } from '../SpacesPage/spaceApi'
import { namespacePath } from './namespaces'
import { organizationErrorMessage, refreshOrganization } from './organizationApi'

export default function CreateOrganizationPage() {
  const { user, isLoading, error: sessionError } = useAuth()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [customSlug, setCustomSlug] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const slug = customSlug ?? makeSpaceSlug(name)
  if (isLoading || (sessionError && !user)) return <AuthStatus />
  if (!user) return <Navigate to="/login" replace state={{ from: '/organization/create' }} />

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    if (!name.trim()) { setError('Please enter a name.'); return }
    setPending(true); setError('')
    try {
      const organization = await createOrganizationNamespace({ name: name.trim(), slug })
      await refreshOrganization(client, organization.slug)
      navigate(namespacePath({ account: organization.slug }), { replace: true })
    } catch (failure) {
      setError(organizationErrorMessage(failure))
      if (apiStatus(failure) === 401) await client.invalidateQueries({ queryKey: ['session'] })
    } finally { setPending(false) }
  }

  return <PageContainer maxW="600px">
    <PageHeading>Create organization</PageHeading>
    <Text mt="10px" mb="28px" color="var(--muted)" fontSize="14px">A shared home for your team’s Spaces.</Text>
    <form onSubmit={create} onChange={() => setError('')}>
      <chakra.fieldset disabled={pending} m="0" p="0" border="0" minW="0">
        <chakra.label htmlFor="organization-name" display="block" mb="8px" fontSize="13px">Name</chakra.label>
        <TextInput id="organization-name" required maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder="My team" />
        <chakra.label htmlFor="organization-slug" display="block" mt="20px" mb="8px" fontSize="13px">URL name</chakra.label>
        <TextInput id="organization-slug" required minLength={3} maxLength={40} pattern="[a-z0-9]+(-[a-z0-9]+)*" title="Use 3–40 lowercase letters, numbers, or single hyphens." value={slug} onChange={event => setCustomSlug(event.target.value)} placeholder="my-team" aria-describedby="organization-url" />
        <Text id="organization-url" mt="8px" fontSize="12px" color="var(--muted)" overflowWrap="anywhere">/{slug || 'your-team'}</Text>
        {error && <Box role="alert" mt="20px" color="fg.error" fontSize="13px">{error}</Box>}
        <Flex justify="flex-end" gap="12px" mt="28px"><ActionButton type="button" disabled={pending} onClick={() => navigate(namespacePath(user!.namespace))}>Cancel</ActionButton><ActionButton type="submit" loading={pending} loadingText="Creating...">Create organization</ActionButton></Flex>
      </chakra.fieldset>
    </form>
  </PageContainer>
}
