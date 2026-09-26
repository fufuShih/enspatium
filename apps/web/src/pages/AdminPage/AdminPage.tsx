import { Flex, Text } from '@chakra-ui/react'
import { useState } from 'react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router'
import AuthStatus from '../../components/AuthStatus'
import RequestState from '../../components/RequestState'
import { ActionButton, PageContainer, PageHeading } from '../../components/ui/Primitives'
import { useAuth } from '../../context/auth'
import AdminUsers from './AdminUsers'
import AdminSystem from './AdminSystem'
import AdminGit from './AdminGit'
import AdminStorage from './AdminStorage'

export default function AdminPage() {
  const { user, isLoading, error } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'system' | 'storage' | 'git' | 'users'>('system')
  const jobs = location.pathname.startsWith('/settings/admin/jobs')
  if (isLoading || error) return <AuthStatus />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (!user.isAdmin) return <PageContainer><RequestState title="Access denied" message="Site administrator access is required." /></PageContainer>
  return <PageContainer maxW="880px">
    <PageHeading>Site administration</PageHeading>
    <Text mt="10px" mb="28px" fontSize="14px" color="var(--muted)">Manage your Enspatium installation.</Text>
    <Flex gap="8px" mb="24px" wrap="wrap">
      {(['system', 'storage', 'git', 'users'] as const).map(value => <ActionButton key={value} aria-pressed={!jobs && tab === value} onClick={() => { setTab(value); if (jobs) void navigate('/settings/admin') }}>{value === 'git' ? 'Git' : value[0]!.toUpperCase() + value.slice(1)}</ActionButton>)}
      <ActionButton aria-pressed={jobs} onClick={() => { void navigate('/settings/admin/jobs') }}>Jobs</ActionButton>
    </Flex>
    {jobs ? <Outlet key={user.id} context={{ currentUserId: user.id }} /> : tab === 'system' ? <AdminSystem key={user.id} currentUserId={user.id} /> : tab === 'git' ? <AdminGit key={user.id} currentUserId={user.id} /> : tab === 'users' ? <AdminUsers key={user.id} currentUserId={user.id} /> : <AdminStorage key={user.id} currentUserId={user.id} />}
  </PageContainer>
}
