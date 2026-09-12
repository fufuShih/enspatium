import { Box, Flex, Heading, Text, chakra } from '@chakra-ui/react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate } from 'react-router'
import { checkStorageIntegrity } from '../../api/generated/admin'
import type { CheckStorageIntegrity200 } from '../../api/generated/api.schemas'
import AuthStatus from '../../components/AuthStatus'
import RequestState from '../../components/RequestState'
import { ActionButton, PageContainer, PageHeading, SelectInput, TextInput } from '../../components/ui/Primitives'
import { useAuth } from '../../context/auth'
import { apiStatus } from '../../context/session'
import AdminUsers from './AdminUsers'

export default function AdminPage() {
  const { user, isLoading, error } = useAuth()
  const [tab, setTab] = useState<'storage' | 'users'>('storage')
  if (isLoading || error) return <AuthStatus />
  if (!user) return <Navigate to="/login" replace state={{ from: '/settings/admin' }} />
  if (!user.isAdmin) return <PageContainer><RequestState title="Access denied" message="Site administrator access is required." /></PageContainer>
  return <PageContainer maxW="880px">
    <PageHeading>Site administration</PageHeading>
    <Text mt="10px" mb="28px" fontSize="14px" color="var(--muted)">Manage your Enspatium installation.</Text>
    <Flex gap="8px" mb="24px"><ActionButton aria-pressed={tab === 'storage'} onClick={() => setTab('storage')}>Storage</ActionButton><ActionButton aria-pressed={tab === 'users'} onClick={() => setTab('users')}>Users</ActionButton></Flex>
    {tab === 'users' ? <AdminUsers key={user.id} currentUserId={user.id} /> : <StorageCheck key={user.id} />}
  </PageContainer>
}

function StorageCheck() {
  const queryClient = useQueryClient()
  const request = useRef<AbortController | null>(null)
  const [spaceId, setSpaceId] = useState('')
  const [mode, setMode] = useState('basic')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  // Reports stay in this view and are cleared when leaving it or changing users.
  const [report, setReport] = useState<CheckStorageIntegrity200 | null>(null)
  const fileCount = report?.spaces.reduce((total, space) => total + space.filesChecked, 0) ?? 0
  useEffect(() => () => { request.current?.abort() }, [])

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    setPending(true)
    setError('')
    setReport(null)
    try {
      const result = await checkStorageIntegrity({ ...(spaceId.trim() ? { spaceId: spaceId.trim() } : {}), deep: mode === 'deep' }, { signal: controller.signal })
      if (!controller.signal.aborted) setReport(result)
    } catch (failure) {
      if (controller.signal.aborted) return
      const status = apiStatus(failure)
      setError(status === 409 ? 'Storage is busy. Wait for the current operation to finish, then try again.'
        : status === 400 ? 'Enter a valid Space ID, or leave it blank to check all Spaces.'
        : status === 401 || status === 403 ? 'Site administrator access is required.'
        : 'Unable to complete the check. Please try again.')
      if (status === 401 || status === 403) await queryClient.invalidateQueries({ queryKey: ['session'] })
    } finally {
      if (!controller.signal.aborted) { request.current = null; setPending(false) }
    }
  }

  return <>
    <Box as="section" border="1px solid var(--border)" borderRadius="8px" p={{ base: '20px', md: '24px' }}>
      <Heading as="h2" fontSize="18px" fontWeight="500">Storage integrity</Heading>
      <Text mt="8px" fontSize="13px" color="var(--muted)" lineHeight="1.8">Check Git repositories and Object versions for missing or changed content. Checks report issues without modifying data.</Text>
      <form onSubmit={run} aria-busy={pending}>
        <chakra.fieldset disabled={pending} border="0" p="0" m="0" minW="0">
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
          <Flex mt="20px" justify="flex-end"><ActionButton type="submit" loading={pending} loadingText="Checking..." bg="var(--foreground)" color="var(--background)">Run check</ActionButton></Flex>
        </chakra.fieldset>
      </form>
      {pending && <Text role="status" mt="16px" fontSize="13px" color="var(--muted)">Checking storage. Large checks may take a couple of minutes.</Text>}
      {error && <Text role="alert" mt="16px" p="12px" bg="bg.error" color="fg.error" borderRadius="6px" fontSize="13px">{error}</Text>}
    </Box>
    {report && <Box as="section" aria-label="Storage check results" mt="28px">
      <Heading as="h2" fontSize="18px" fontWeight="500" role="status">{report.status === 'ok' ? 'No issues found' : report.status === 'issues' ? 'Issues found' : 'Check incomplete'}</Heading>
      <Text mt="8px" fontSize="13px" color="var(--muted)" lineHeight="1.8">{report.mode === 'deep' ? 'Deep verification' : 'Basic check'} · {report.spaces.length} {report.spaces.length === 1 ? 'Space' : 'Spaces'} · {fileCount} {fileCount === 1 ? 'file' : 'files'} checked</Text>
      <Text mt="4px" fontSize="12px" color="var(--muted)">Finished {new Date(report.finishedAt).toLocaleString('en-US')}</Text>
      {report.status === 'incomplete' && <Text mt="12px" fontSize="13px" color="var(--muted)">Some content could not be verified. Review the findings and try a single Space.</Text>}
      {report.issues.length > 0 && <Box as="ul" listStyleType="none" m="0" mt="20px" p="0" border="1px solid var(--border)" borderRadius="8px">
        {report.issues.map((issue, index) => <Box as="li" key={index} p="16px" _notFirst={{ borderTop: '1px solid var(--border)' }}>
          <Flex align="center" gap="10px" wrap="wrap"><Text fontSize="11px" textTransform="capitalize" color={issue.severity === 'error' ? 'fg.error' : 'var(--muted)'}>{issue.severity}</Text><Text fontSize="13px" fontWeight="500" overflowWrap="anywhere">{issue.code}</Text></Flex>
          <Text mt="6px" fontSize="13px" lineHeight="1.8">{issue.message}</Text>
          {(issue.spaceId || issue.key || issue.versionId || issue.path || issue.detail) && <Box as="dl" mt="8px" fontSize="12px" color="var(--muted)" lineHeight="1.8" overflowWrap="anywhere">
            {([['Space', issue.spaceId], ['Object', issue.key], ['Version', issue.versionId], ['Path', issue.path], ['Details', issue.detail]] as const).filter(([, value]) => value).map(([label, value]) => <Box key={label}><chakra.dt display="inline" fontWeight="500">{label}: </chakra.dt><chakra.dd display="inline" m="0" whiteSpace="pre-wrap">{value}</chakra.dd></Box>)}
          </Box>}
        </Box>)}
      </Box>}
    </Box>}
  </>
}
