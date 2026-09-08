import { Box, Heading, Text } from '@chakra-ui/react'
import { useGetNamespace } from '../../api/generated/namespaces'
import MemberManager from '../../components/MemberManager'
import RequestState from '../../components/RequestState'
import { PageLink } from '../../components/ui/Primitives'
import { namespacePath } from '../UserPage/namespaces'

export default function SpaceMembers({ account, slug }: { account: string; slug: string }) {
  const profile = useGetNamespace(account, { query: { retry: false } })
  return <Box borderTop="1px solid var(--border)" mt="32px" pt="28px">
    {profile.isPending ? <RequestState loading title="Loading account..." /> : profile.isError ? <RequestState title="Unable to load account" onRetry={() => { void profile.refetch() }} /> : profile.data.kind === 'personal' ? <>
      <Heading as="h2" fontSize="17px">Members</Heading>
      <Text mt="10px" fontSize="13px" color="var(--muted)">Personal Spaces are managed by their owner. Create a Space in an organization to collaborate.</Text>
      <PageLink to="/organization/create" display="inline-block" mt="14px" fontSize="13px">Create organization</PageLink>
    </> : <>
      <MemberManager scope={{ kind: 'space', account, slug }} />
      <PageLink to={namespacePath({ account })} display="inline-block" mt="12px" fontSize="13px">Go to organization</PageLink>
    </>}
  </Box>
}
