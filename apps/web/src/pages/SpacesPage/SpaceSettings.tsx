import { Box, Flex, Heading, Text, chakra } from '@chakra-ui/react'
import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import type { GetSpace200 } from '../../api/generated/api.schemas'
import { getGetGitSpaceInfoQueryKey, updateGitSpaceDefaultBranch, updateSpace, useGetGitSpaceInfo } from '../../api/generated/spaces'
import { ActionButton, SelectInput, TextInput } from '../../components/ui/Primitives'
import RequestState from '../../components/RequestState'
import { useAuth } from '../../context/auth'
import { apiStatus } from '../../context/session'
import DeleteSpaceButton from './DeleteSpaceButton'
import { refreshSpaceSettings, settingsErrorMessage } from './settingsApi'
import { storageErrorTitle } from './storageErrors'

export default function SpaceSettings({ account, space }: { account: string; space: GetSpace200 }) {
  const client = useQueryClient()
  const [name, setName] = useState(space.name)
  const [visibility, setVisibility] = useState(space.visibility)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const dirty = name.trim() !== space.name || visibility !== space.visibility

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || !dirty) return
    if (!name.trim()) { setError('Please enter a name.'); return }
    setPending(true); setError(''); setSaved(false)
    try {
      const updated = await updateSpace(account, space.slug, { name: name.trim(), visibility })
      setName(updated.name); setVisibility(updated.visibility)
      await refreshSpaceSettings(client, account, space.slug)
      setSaved(true)
    } catch (failure) {
      setError(settingsErrorMessage(failure))
      if (apiStatus(failure) === 401) await client.invalidateQueries({ queryKey: ['session'] })
      if (apiStatus(failure) === 403) await refreshSpaceSettings(client, account, space.slug)
    } finally { setPending(false) }
  }

  return <Box maxW="640px">
    <Box as="section" aria-labelledby="general-heading">
      <Heading as="h2" id="general-heading" fontSize="17px" mb="20px">General</Heading>
      <form onSubmit={save} onChange={() => { setSaved(false); setError('') }}>
        <chakra.fieldset disabled={pending} border="0" p="0" m="0" minW="0">
          <chakra.label htmlFor="settings-name" display="block" fontSize="13px" mb="8px">Name</chakra.label>
          <TextInput id="settings-name" value={name} onChange={event => setName(event.target.value)} required maxLength={100} />
          <Text mt="8px" color="var(--muted)" fontSize="12px" overflowWrap="anywhere">The URL stays /{account}/{space.slug}.</Text>
          <chakra.label htmlFor="settings-visibility" display="block" fontSize="13px" mt="20px" mb="8px">Visibility</chakra.label>
          <SelectInput id="settings-visibility" value={visibility} onChange={event => setVisibility(event.target.value === 'public' ? 'public' : 'private')}><option value="private">Private</option><option value="public">Public</option></SelectInput>
          <Text mt="8px" color="var(--muted)" fontSize="12px">{visibility === 'public' ? 'Anyone can view this Space and its contents.' : 'Only people with access can view this Space.'}</Text>
          {error && <Text role="alert" color="fg.error" fontSize="13px" mt="16px">{error}</Text>}
          <Flex align="center" justify="space-between" gap="12px" mt="20px">
            <Text role="status" fontSize="13px" color="var(--muted)">{saved ? 'Changes saved.' : ''}</Text>
            <ActionButton type="submit" disabled={pending || !dirty || !name.trim()} loading={pending} loadingText="Saving...">Save changes</ActionButton>
          </Flex>
        </chakra.fieldset>
      </form>
    </Box>
    {space.type === 'git' && <GitSettings account={account} slug={space.slug} />}
    {space.canDelete && <Box as="section" aria-labelledby="danger-heading" borderTop="1px solid var(--border)" mt="32px" pt="28px">
      <Heading as="h2" id="danger-heading" fontSize="17px">Danger zone</Heading>
      <Flex align="center" justify="space-between" gap="20px" wrap="wrap" mt="16px"><Text fontSize="13px" color="var(--muted)">Permanently delete this Space and its contents.</Text><DeleteSpaceButton account={account} slug={space.slug} /></Flex>
    </Box>}
  </Box>
}

function GitSettings({ account, slug }: { account: string; slug: string }) {
  const { user } = useAuth()
  const client = useQueryClient()
  const info = useGetGitSpaceInfo(account, slug, { query: { retry: false, queryKey: [...getGetGitSpaceInfoQueryKey(account, slug), user?.id ?? null] } })
  const [selected, setSelected] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const branch = selected ?? info.data?.defaultBranch ?? ''

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || !info.data?.branches.includes(branch) || branch === info.data.defaultBranch) return
    setPending(true); setError(''); setSaved(false)
    try {
      await updateGitSpaceDefaultBranch(account, slug, { branch })
      await refreshSpaceSettings(client, account, slug)
      setSelected(null); setSaved(true)
    } catch (failure) {
      setError(settingsErrorMessage(failure))
      if (apiStatus(failure) === 401) await client.invalidateQueries({ queryKey: ['session'] })
      else await refreshSpaceSettings(client, account, slug)
    } finally { setPending(false) }
  }

  return <Box as="section" aria-labelledby="git-settings-heading" borderTop="1px solid var(--border)" mt="32px" pt="28px">
    <Heading as="h2" id="git-settings-heading" fontSize="17px" mb="20px">Git</Heading>
    {info.isPending ? <RequestState loading title="Loading branches..." /> : info.isError ? <RequestState title={storageErrorTitle(info.error, 'Unable to load branches')} message={settingsErrorMessage(info.error)} onRetry={() => { void info.refetch() }} /> : info.data.branches.length === 0 ? <Box><Text color="var(--muted)" fontSize="13px">Push your first branch to choose a default branch.</Text><ActionButton mt="16px" loading={info.isFetching} onClick={() => { void info.refetch() }}>Refresh branches</ActionButton></Box> : <form onSubmit={save}>
      <chakra.label htmlFor="settings-branch" display="block" fontSize="13px" mb="8px">Default branch</chakra.label>
      <SelectInput id="settings-branch" disabled={pending} value={branch} onChange={event => { setSelected(event.target.value); setSaved(false); setError('') }}>
        {!info.data.branches.includes(branch) && <option value={branch} disabled>Select a branch</option>}
        {info.data.branches.map(item => <option key={item} value={item}>{item}</option>)}
      </SelectInput>
      <Text mt="8px" color="var(--muted)" fontSize="12px">Used when browsing this Space and cloning the repository.</Text>
      {error && <Text role="alert" color="fg.error" fontSize="13px" mt="16px">{error}</Text>}
      <Flex align="center" justify="space-between" gap="12px" mt="20px"><Text role="status" fontSize="13px" color="var(--muted)">{saved ? 'Default branch saved.' : ''}</Text><ActionButton type="submit" disabled={pending || !info.data.branches.includes(branch) || branch === info.data.defaultBranch} loading={pending} loadingText="Saving...">Save default branch</ActionButton></Flex>
    </form>}
  </Box>
}
