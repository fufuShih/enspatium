import { Box, Flex, Text, chakra } from '@chakra-ui/react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { ActionButton, PageContainer, PageHeading, PageLink, SelectInput, TextArea, TextInput } from '../../components/ui/Primitives'
import { useMockAuth } from '../../context/mockAuth'
import { useSpaces } from '../../context/spaces'
import type { Space } from './spaceData'
import { spacePath } from './spaceData'
import { demoOrganization, namespacePath, sameNamespace } from '../UserPage/namespaces'

export default function CreateSpacePage() {
  const { user } = useMockAuth()
  const { spaces, setSpaces } = useSpaces()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [ownerKey, setOwnerKey] = useState('')

  if (!user) return <Navigate to="/login" replace state={{ from: '/space/create' }} />
  const owner = ownerKey === namespacePath(demoOrganization) ? demoOrganization : user.namespace

  function createSpace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const name = String(data.get('name') ?? '').trim()
    const slug = name.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '')
    if (!slug || spaces.some(space => sameNamespace(space.owner, owner) && space.slug === slug)) {
      setError(slug ? 'This name is already in use for this owner.' : 'Use a name with at least one letter or number.')
      return
    }
    const id = crypto.randomUUID()
    const space: Space = {
      id,
      owner,
      slug,
      name,
      description: String(data.get('description') ?? '').trim(),
      type: data.get('type') === 'Object' ? 'Object' : 'Git',
      visibility: data.get('visibility') === 'Public' ? 'Public' : 'Private',
      updated: 'Just now',
      items: [],
    }
    setSpaces(current => [space, ...current])
    navigate(spacePath(space), { replace: true })
  }

  return (
    <PageContainer maxW="600px">
      <PageHeading mb="28px">Create Space</PageHeading>
      <Flex asChild direction="column">
        <form onSubmit={createSpace}>
          <chakra.label htmlFor="space-owner" fontSize="13px" mb="8px">Owner</chakra.label>
          <SelectInput id="space-owner" value={namespacePath(owner)} onChange={event => { setOwnerKey(event.target.value); setError('') }}>
            <option value={namespacePath(user.namespace)}>{user.namespace.account} (Personal)</option>
            <option value={namespacePath(demoOrganization)}>{demoOrganization.account} (Organization)</option>
          </SelectInput>
          <chakra.label htmlFor="space-name" fontSize="13px" mt="20px" mb="8px">Name</chakra.label>
          <TextInput id="space-name" name="name" required maxLength={60} placeholder="my-next-project" aria-invalid={Boolean(error)} aria-describedby={error ? 'space-name-error' : undefined} onChange={() => setError('')} />
          {error && <Text id="space-name-error" color="#bd4940" fontSize="13px" mt="16px" role="alert">{error}</Text>}

          <chakra.label htmlFor="space-description" fontSize="13px" mt="20px" mb="8px">Description (optional)</chakra.label>
          <TextArea id="space-description" name="description" maxLength={200} rows={3} />

          <Flex gap="16px">
            <Box flex="1" minW="0">
              <chakra.label htmlFor="space-type" display="block" fontSize="13px" mt="20px" mb="8px">Type</chakra.label>
              <SelectInput id="space-type" name="type"><option value="Git">Git repository</option><option value="Object">Object storage</option></SelectInput>
            </Box>
            <Box flex="1" minW="0">
              <chakra.label htmlFor="space-visibility" display="block" fontSize="13px" mt="20px" mb="8px">Visibility</chakra.label>
              <SelectInput id="space-visibility" name="visibility"><option value="Private">Private</option><option value="Public">Public</option></SelectInput>
            </Box>
          </Flex>

          <Flex gap="16px" justify="flex-end" mt="28px">
            <ActionButton asChild><PageLink to={namespacePath(owner)}>Cancel</PageLink></ActionButton>
            <ActionButton type="submit" bg="var(--foreground)" color="var(--background)" borderColor="var(--foreground)">Create Space</ActionButton>
          </Flex>
        </form>
      </Flex>
    </PageContainer>
  )
}
