import { Box, Flex, Heading, Text, chakra } from '@chakra-ui/react'
import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { GetSpace200 } from '../../api/generated/api.schemas'
import { updateSpace } from '../../api/generated/spaces'
import { ActionButton, TextInput } from '../../components/ui/Primitives'
import { apiStatus } from '../../context/session'
import { refreshSpaceSettings, settingsErrorMessage } from './settingsApi'

export default function ObjectRetentionSettings({ account, space }: { account: string; space: GetSpace200 }) {
  const client = useQueryClient()
  const [limit, setLimit] = useState(String(space.objectVersionLimit))
  const [days, setDays] = useState(String(space.objectRetentionDays))
  const [pending, setPending] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const versionLimit = Number(limit)
  const retentionDays = Number(days)
  const valid = Number.isInteger(versionLimit) && versionLimit >= 1 && versionLimit <= 1000
    && Number.isInteger(retentionDays) && retentionDays >= 1 && retentionDays <= 36500
  const dirty = versionLimit !== space.objectVersionLimit || retentionDays !== space.objectRetentionDays
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || !valid || !dirty) return
    setPending(true); setSaved(false); setError('')
    try {
      await updateSpace(account, space.slug, { objectVersionLimit: versionLimit, objectRetentionDays: retentionDays })
      await refreshSpaceSettings(client, account, space.slug)
      setSaved(true)
    } catch (failure) {
      setError(settingsErrorMessage(failure))
      if (apiStatus(failure) === 401) void client.invalidateQueries({ queryKey: ['session'] })
    } finally { setPending(false) }
  }
  return <Box as="section" aria-labelledby="retention-heading" borderTop="1px solid var(--border)" mt="32px" pt="28px">
    <Heading as="h2" id="retention-heading" fontSize="17px" mb="20px">Version retention</Heading>
    <form onSubmit={save} onChange={() => { setSaved(false); setError('') }}>
      <chakra.fieldset disabled={pending} border="0" p="0" m="0" minW="0">
        <chakra.label htmlFor="version-limit" display="block" fontSize="13px" mb="8px">Maximum versions</chakra.label>
        <TextInput id="version-limit" type="number" min={1} max={1000} step={1} required value={limit} onChange={event => setLimit(event.target.value)} />
        <Text mt="8px" fontSize="12px" color="var(--muted)">Includes the current content version. Deletion markers do not count.</Text>
        <chakra.label htmlFor="retention-days" display="block" fontSize="13px" mt="20px" mb="8px">Inactive retention (days)</chakra.label>
        <TextInput id="retention-days" type="number" min={1} max={36500} step={1} required value={days} onChange={event => setDays(event.target.value)} />
        <Text mt="8px" fontSize="12px" color="var(--muted)">A version becomes inactive when replaced or when the file is deleted.</Text>
        <Text mt="16px" fontSize="13px" lineHeight="1.8">Periodic cleanup permanently deletes versions exceeding either limit. The current content version is always kept. Changes also apply to existing history.</Text>
        {error && <Text role="alert" mt="16px" fontSize="13px" color="fg.error">{error}</Text>}
        <Flex justify="space-between" align="center" gap="12px" mt="20px">
          <Text role="status" fontSize="13px" color="var(--muted)">{saved ? 'Retention settings saved.' : ''}</Text>
          <ActionButton type="submit" disabled={pending || !dirty || !valid} loading={pending} loadingText="Saving...">Save retention</ActionButton>
        </Flex>
      </chakra.fieldset>
    </form>
  </Box>
}
