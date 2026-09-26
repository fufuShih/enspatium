import { Box, Flex, Heading, Text, chakra } from '@chakra-ui/react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { createAdminJob } from '../../api/generated/admin'
import { ActionButton, PageLink, SelectInput, TextInput } from '../../components/ui/Primitives'
import { jobError, useJobAction } from './jobs'

export default function AdminStorage({ currentUserId }: { currentUserId: string }) {
  const navigate = useNavigate()
  const action = useJobAction(currentUserId)
  const [spaceId, setSpaceId] = useState('')
  const [mode, setMode] = useState('basic')
  function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void action.run(signal => createAdminJob({ kind: 'storage.check', payload: { ...(spaceId.trim() ? { spaceId: spaceId.trim() } : {}), deep: mode === 'deep' } }, { signal }), job => { void navigate('/settings/admin/jobs/' + job.id) })
  }
  return <Box as="section" border="1px solid var(--border)" borderRadius="8px" p={{ base: '20px', md: '24px' }}>
    <Heading as="h2" fontSize="18px" fontWeight="500">Storage integrity</Heading>
    <Text mt="8px" fontSize="13px" color="var(--muted)" lineHeight="1.8">Check Git repositories and Object versions for missing or changed content. Checks report issues without modifying data.</Text>
    <form onSubmit={run} aria-busy={action.pending}>
      <chakra.fieldset disabled={action.pending || action.denied} border="0" p="0" m="0" minW="0">
        <Flex mt="24px" gap="16px" direction={{ base: 'column', sm: 'row' }}>
          <Box flex="1" minW="0">
            <chakra.label htmlFor="check-space" display="block" fontSize="13px" mb="8px">Space ID (optional)</chakra.label>
            <TextInput id="check-space" value={spaceId} onChange={event => setSpaceId(event.target.value)} placeholder="All Spaces" autoComplete="off" spellCheck={false} aria-describedby="check-scope-help" />
            <Text id="check-scope-help" mt="6px" fontSize="12px" color="var(--muted)">Leave blank to check all Spaces.</Text>
          </Box>
          <Box w={{ base: '100%', sm: '190px' }}>
            <chakra.label htmlFor="check-mode" display="block" fontSize="13px" mb="8px">Check type</chakra.label>
            <SelectInput id="check-mode" value={mode} onChange={event => setMode(event.target.value)}><option value="basic">Basic</option><option value="deep">Deep verification</option></SelectInput>
          </Box>
        </Flex>
        <Text mt="16px" fontSize="12px" color="var(--muted)" lineHeight="1.8">{mode === 'deep' ? 'Deep verification reads file contents and checks Git objects. ' : 'Basic checks verify metadata, file sizes and Git references. '}Writes pause during a check; browsing and downloads remain available.</Text>
        <Text mt="8px" fontSize="12px" color="var(--muted)" lineHeight="1.8">Checks run in the background. You can leave this page and return to <PageLink to="/settings/admin/jobs" textDecoration="underline">Jobs</PageLink> to view the report.</Text>
        <Flex mt="20px" justify="flex-end"><ActionButton type="submit" loading={action.pending} loadingText="Queuing..." bg="var(--foreground)" color="var(--background)">Run check</ActionButton></Flex>
      </chakra.fieldset>
    </form>
    {!!action.error && <Text role="alert" mt="16px" p="12px" bg="bg.error" color="fg.error" borderRadius="6px" fontSize="13px">{jobError(action.error)}</Text>}
  </Box>
}
