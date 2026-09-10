import { Box, Flex, Text, chakra } from '@chakra-ui/react'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { getListNamespacesQueryKey, useListNamespaces } from '../../api/generated/namespaces'
import { useCreateSpace } from '../../api/generated/spaces'
import { ActionButton, PageContainer, PageHeading, PageLink, SelectInput, TextInput } from '../../components/ui/Primitives'
import AuthStatus from '../../components/AuthStatus'
import RequestState from '../../components/RequestState'
import { useAuth } from '../../context/auth'
import { apiStatus } from '../../context/session'
import { namespacePath } from '../UserPage/namespaces'
import { cacheCreatedSpace, creatableNamespaces, makeSpaceSlug, spaceErrorMessage, spacePath } from './spaceApi'
import { getAppPlugin } from '../AppPages/registry'
import { getListAppsQueryKey, useListApps } from '../../api/generated/apps'

export default function CreateSpacePage() {
  const { user, isLoading, error: sessionError } = useAuth()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [ownerKey, setOwnerKey] = useState(params.get('owner') ?? '')
  const [name, setName] = useState('')
  const [customSlug, setCustomSlug] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const owners = useListNamespaces({ query: { enabled: Boolean(user), retry: false, queryKey: [...getListNamespacesQueryKey(), user?.id ?? null] } })
  const apps = useListApps({ query: { enabled: Boolean(user), retry: false, queryKey: [...getListAppsQueryKey(), user?.id ?? null] } })
  const availableApps = (apps.data ?? []).filter(app => getAppPlugin(app.type)?.integration.storageType === app.storageType)
  const create = useCreateSpace({ mutation: { retry: false } })
  const available = creatableNamespaces(owners.data ?? [], user?.id ?? '')
  const owner = available.find(item => item.slug === ownerKey) ?? available.find(item => item.kind === 'personal') ?? available[0]
  const slug = customSlug ?? makeSpaceSlug(name)

  if (isLoading || (sessionError && !user)) return <AuthStatus />
  if (!user) return <Navigate to="/login" replace state={{ from: `/space/create${params.size ? `?${params}` : ''}` }} />
  if (owners.isPending || apps.isPending) return <PageContainer><RequestState loading title="Loading Space options..." /></PageContainer>
  if (owners.isError) return <PageContainer><RequestState title="Unable to load accounts" message={spaceErrorMessage(owners.error)} onRetry={() => { void owners.refetch() }} /></PageContainer>
  if (apps.isError) return <PageContainer><RequestState title="Unable to load apps" onRetry={() => { void apps.refetch() }} /></PageContainer>
  if (!owner) return <PageContainer><RequestState title="No accounts available" message="You need to own an account or organization to create a Space." /></PageContainer>

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || !user || !owner) return
    const form = new FormData(event.currentTarget)
    const type = String(form.get('type'))
    const app = availableApps.find(app => app.type === type)
    if (!app && type !== 'git' && type !== 'object') { setError('Choose an available Space type.'); return }
    if (!name.trim()) { setError('Please enter a name.'); return }
    setError('')
    setSubmitting(true)
    try {
      const space = await create.mutateAsync({ namespaceSlug: owner.slug, data: {
        name: name.trim(), slug,
        type: app?.storageType ?? (type === 'git' ? 'git' : 'object'),
        app: app?.type ?? null,
        visibility: form.get('visibility') === 'public' ? 'public' : 'private',
      } })
      await cacheCreatedSpace(client, owner.slug, user.id, space)
      navigate(spacePath(owner.slug, space.slug), { replace: true })
    } catch (failure) {
      setError(spaceErrorMessage(failure))
      if (apiStatus(failure) === 401) await client.invalidateQueries({ queryKey: ['session'] })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PageContainer maxW="600px">
      <PageHeading>Create Space</PageHeading>
      <Text mt="10px" mb="28px" fontSize="14px" color="var(--muted)">A home for your code or files.</Text>
      <form onSubmit={handleCreate} onChange={() => setError('')} aria-busy={submitting}>
        <chakra.fieldset disabled={submitting} border="0" p="0" m="0" minW="0">
          <chakra.label htmlFor="space-owner" display="block" fontSize="13px" mb="8px">Owner</chakra.label>
          <SelectInput id="space-owner" value={owner.slug} onChange={event => setOwnerKey(event.target.value)}>
            {available.map(item => <option key={item.id} value={item.slug}>{item.name} ({item.kind === 'personal' ? 'Personal' : 'Organization'})</option>)}
          </SelectInput>
          <chakra.label htmlFor="space-name" display="block" fontSize="13px" mt="20px" mb="8px">Name</chakra.label>
          <TextInput id="space-name" name="name" required maxLength={100} placeholder="My next project" value={name} onChange={event => setName(event.target.value)} />
          <chakra.label htmlFor="space-slug" display="block" fontSize="13px" mt="20px" mb="8px">URL name</chakra.label>
          <TextInput id="space-slug" name="slug" required minLength={3} maxLength={40} pattern="[a-z0-9]+(-[a-z0-9]+)*" title="Use 3–40 lowercase letters, numbers, or single hyphens." placeholder="my-next-project" value={slug} onChange={event => setCustomSlug(event.target.value)} aria-describedby="space-url-hint" />
          <Text id="space-url-hint" mt="8px" fontSize="12px" color="var(--muted)" overflowWrap="anywhere">{namespacePath({ account: owner.slug })}/{slug || 'your-space'}<br />3–40 lowercase letters, numbers, or single hyphens.</Text>
          <Flex gap="16px" mt="20px">
            <Box flex="1" minW="0">
              <chakra.label htmlFor="space-type" display="block" fontSize="13px" mb="8px">Type</chakra.label>
              <SelectInput id="space-type" name="type"><option value="git">Git repository</option><option value="object">Object storage</option>{availableApps.map(app => <option key={app.type} value={app.type}>{app.name}{app.kind === 'builtin' ? ' (built-in)' : ''}</option>)}</SelectInput>
            </Box>
            <Box flex="1" minW="0">
              <chakra.label htmlFor="space-visibility" display="block" fontSize="13px" mb="8px">Visibility</chakra.label>
              <SelectInput id="space-visibility" name="visibility"><option value="private">Private</option><option value="public">Public</option></SelectInput>
            </Box>
          </Flex>
          {error && <Text role="alert" bg="bg.error" color="fg.error" p="12px 14px" borderRadius="8px" fontSize="13px" mt="20px">{error}</Text>}
          <Flex gap="16px" justify="flex-end" mt="28px">
            <ActionButton type="button" disabled={submitting} onClick={() => navigate(namespacePath({ account: owner.slug }))}>Cancel</ActionButton>
            <ActionButton type="submit" loading={submitting} loadingText="Creating..." bg="var(--foreground)" color="var(--background)" borderColor="var(--foreground)">Create Space</ActionButton>
          </Flex>
        </chakra.fieldset>
      </form>
      <PageLink to={namespacePath(user.namespace)} display="block" mt="24px" fontSize="13px" color="var(--muted)">Back to profile</PageLink>
    </PageContainer>
  )
}
