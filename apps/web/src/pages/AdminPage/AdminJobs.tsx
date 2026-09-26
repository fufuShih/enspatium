import { Box, Flex, Heading, Text, chakra } from '@chakra-ui/react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router'
import { cancelAdminJob, getAdminJob, listAdminJobs, retryAdminJob } from '../../api/generated/admin'
import { ListAdminJobsStatus } from '../../api/generated/api.schemas'
import type { ListAdminJobsParams } from '../../api/generated/api.schemas'
import RequestState from '../../components/RequestState'
import { ActionButton, PageLink, SelectInput } from '../../components/ui/Primitives'
import { apiStatus } from '../../context/session'
import StorageCheckReport from './StorageCheckReport'
import { jobError, jobKeys, unfinished, useJobAccess, useJobAction } from './jobs'

const formatTime = (at: string | null) => at ? new Date(at).toLocaleString('en-US') : '—'
const label = (value: string) => value[0]!.toUpperCase() + value.slice(1)

export default function AdminJobs() {
  const { currentUserId } = useOutletContext<{ currentUserId: string }>()
  const [status, setStatus] = useState<ListAdminJobsParams['status']>()
  const [cursors, setCursors] = useState<string[]>([])
  const params = { status, cursor: cursors.at(-1) }
  const query = useQuery({
    queryKey: [...jobKeys(currentUserId), 'list', params],
    queryFn: ({ signal }) => listAdminJobs(params, { signal }),
    retry: false, gcTime: 0,
    refetchInterval: query => !query.state.error && query.state.data?.jobs.some(unfinished) ? 2_000 : false,
  })
  useJobAccess(query.error, currentUserId)
  return <Box as="section" aria-label="Job history">
    <Flex justify="space-between" align="center" gap="16px" wrap="wrap">
      <Heading as="h2" fontSize="18px" fontWeight="500">Background jobs</Heading>
      <ActionButton loading={query.isFetching} onClick={() => { if (cursors.length) setCursors([]); else void query.refetch() }}>Refresh Jobs</ActionButton>
    </Flex>
    <Text mt="8px" fontSize="13px" color="var(--muted)" lineHeight="1.8">Persistent storage checks, newest first. Open a job to view its report, cancel queued work or retry a failed check.</Text>
    <Box mt="20px" maxW="220px">
      <chakra.label htmlFor="job-status" display="block" fontSize="13px" mb="8px">Job status</chakra.label>
      <SelectInput id="job-status" value={status ?? ''} onChange={event => { setStatus(event.target.value ? event.target.value as ListAdminJobsParams['status'] : undefined); setCursors([]) }}>
        <option value="">All statuses</option>
        {Object.values(ListAdminJobsStatus).map(value => <option key={value} value={value}>{label(value)}</option>)}
      </SelectInput>
    </Box>
    {query.isPending ? <RequestState loading title="Loading jobs..." /> : query.isError ? <RequestState title="Jobs unavailable" message={jobError(query.error)} onRetry={() => { void query.refetch() }} /> : <>
      {!query.data.jobs.length ? <Text mt="28px" fontSize="13px" color="var(--muted)">No jobs match this status. Start a check from Storage.</Text> : <Box as="ul" listStyleType="none" p="0" mt="24px" border="1px solid var(--border)" borderRadius="8px">
        {query.data.jobs.map(job => <Box as="li" key={job.id} p="20px" _notFirst={{ borderTop: '1px solid var(--border)' }}>
          <Flex justify="space-between" gap="12px" wrap="wrap">
            <PageLink to={'/settings/admin/jobs/' + job.id} fontSize="14px" fontWeight="500" textDecoration="underline">{job.kind === 'storage.check' ? 'Storage check' : job.kind} · {job.id.slice(0, 8)}</PageLink>
            <Text fontSize="12px" color={job.status === 'failed' ? 'fg.error' : 'var(--muted)'}>{label(job.status)}</Text>
          </Flex>
          <Text mt="8px" fontSize="12px" color="var(--muted)" overflowWrap="anywhere">{job.payload.deep ? 'Deep verification' : 'Basic check'} · {job.payload.spaceId ?? 'All Spaces'}</Text>
          <Text mt="6px" fontSize="12px" color="var(--muted)">Created {formatTime(job.createdAt)}</Text>
          {job.errorCode && <Text mt="6px" fontSize="12px" color="fg.error" overflowWrap="anywhere">{job.errorCode}</Text>}
        </Box>)}
      </Box>}
      <Flex mt="20px" gap="12px" align="center" wrap="wrap">
        <ActionButton disabled={!cursors.length || query.isFetching} onClick={() => setCursors(values => values.slice(0, -1))}>Previous</ActionButton>
        <Text fontSize="12px" color="var(--muted)">Page {cursors.length + 1}</Text>
        <ActionButton disabled={!query.data.nextCursor || query.isFetching} onClick={() => { if (query.data.nextCursor) setCursors(values => [...values, query.data.nextCursor!]) }}>Next</ActionButton>
      </Flex>
      {query.data.jobs.some(unfinished) && <Text mt="16px" fontSize="12px" color="var(--muted)">Unfinished jobs update every 2 seconds while this page is open.</Text>}
    </>}
  </Box>
}

export function AdminJobPage() {
  const { currentUserId } = useOutletContext<{ currentUserId: string }>()
  const { jobId = '' } = useParams()
  return <JobDetail key={currentUserId + jobId} currentUserId={currentUserId} id={jobId} />
}

function JobDetail({ currentUserId, id }: { currentUserId: string; id: string }) {
  const navigate = useNavigate()
  const action = useJobAction(currentUserId)
  const query = useQuery({
    queryKey: [...jobKeys(currentUserId), 'detail', id],
    queryFn: ({ signal }) => getAdminJob(id, { signal }),
    retry: false, gcTime: 0,
    refetchInterval: query => !query.state.error && query.state.data && unfinished(query.state.data) ? 2_000 : false,
  })
  const denied = useJobAccess(query.error, currentUserId) || action.denied
  const back = <PageLink to="/settings/admin/jobs" fontSize="13px" textDecoration="underline">Back to Jobs</PageLink>
  if (denied) return <RequestState title="Access denied" message="Site administrator access is required." />
  if (query.isPending) return <RequestState loading title="Loading job...">{back}</RequestState>
  if (query.isError) return <RequestState title={apiStatus(query.error) === 404 ? 'Job not found' : 'Job unavailable'} message={jobError(query.error)} onRetry={() => { void query.refetch() }}>{back}</RequestState>
  const job = query.data
  return <Box as="section" aria-label="Job details" minW="0">
    {back}
    <Flex mt="20px" justify="space-between" align="center" gap="16px" wrap="wrap">
      <Heading as="h2" fontSize="18px" fontWeight="500">{job.kind === 'storage.check' ? 'Storage check' : job.kind}</Heading>
      <ActionButton loading={query.isFetching} disabled={action.pending} onClick={() => { void query.refetch() }}>Refresh job</ActionButton>
    </Flex>
    <Text role="status" mt="12px" fontSize="14px" fontWeight="500" color={job.status === 'failed' ? 'fg.error' : 'var(--foreground)'}>Execution: {label(job.status)}</Text>
    <Text mt="8px" fontSize="13px" color="var(--muted)" lineHeight="1.8">{unfinished(job) ? 'This job continues if you leave. Status updates every 2 seconds while this page is open.' : job.status === 'succeeded' ? 'Execution finished. Review the report below for findings or incomplete checks.' : job.status === 'failed' ? 'The job did not finish successfully. Review the error before creating a retry.' : 'Cancelled before execution. No check was performed.'}</Text>
    <Box as="dl" mt="20px" p="20px" border="1px solid var(--border)" borderRadius="8px" fontSize="12px" lineHeight="1.9" overflowWrap="anywhere">
      {[
        ['Job ID', job.id], ['Check type', job.payload.deep ? 'Deep verification' : 'Basic check'],
        ['Space', job.payload.spaceId ?? 'All Spaces'], ['Requested by', job.requestedByUserId ?? 'Deleted user'],
        ['Created', formatTime(job.createdAt)], ['Started', formatTime(job.startedAt)], ['Finished', formatTime(job.finishedAt)],
      ].map(([name, value]) => <Box key={name}><chakra.dt display="inline" fontWeight="500">{name}: </chakra.dt><chakra.dd display="inline" m="0" color="var(--muted)">{value}</chakra.dd></Box>)}
      {job.retryOfJobId && <Box><chakra.dt display="inline" fontWeight="500">Retry of: </chakra.dt><chakra.dd display="inline" m="0"><PageLink to={'/settings/admin/jobs/' + job.retryOfJobId} textDecoration="underline">{job.retryOfJobId}</PageLink></chakra.dd></Box>}
    </Box>
    {job.errorCode && <Box role="alert" mt="20px" p="16px" bg="bg.error" color="fg.error" borderRadius="8px" fontSize="13px" overflowWrap="anywhere"><Text fontWeight="500">{job.errorCode}</Text><Text mt="6px">{job.errorMessage}</Text></Box>}
    <Flex mt="20px" gap="12px" wrap="wrap">
      {job.canCancel && <ActionButton loading={action.pending} disabled={query.isFetching} onClick={() => { void action.run(signal => cancelAdminJob(id, { signal }), () => {}) }}>Cancel job</ActionButton>}
      {job.canRetry && <ActionButton loading={action.pending} disabled={query.isFetching} onClick={() => { void action.run(signal => retryAdminJob(id, { signal }), retry => { void navigate('/settings/admin/jobs/' + retry.id) }) }}>Retry job</ActionButton>}
    </Flex>
    {!!action.error && <Text role="alert" mt="16px" fontSize="13px" color="fg.error">{jobError(action.error)}</Text>}
    {job.result && <StorageCheckReport report={job.result} />}
  </Box>
}
