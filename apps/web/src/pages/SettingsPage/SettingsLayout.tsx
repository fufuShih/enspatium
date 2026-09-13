import { Box, Heading } from '@chakra-ui/react'
import { Navigate, Outlet, useLocation } from 'react-router'
import AuthStatus from '../../components/AuthStatus'
import { PageContainer, PageLink } from '../../components/ui/Primitives'
import { useAuth } from '../../context/auth'

export default function SettingsLayout() {
  const { user, isLoading, error } = useAuth()
  const location = useLocation()
  if (isLoading || (error && !user)) return <AuthStatus />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <PageContainer maxW="1120px" display="grid" gridTemplateColumns={{ base: 'minmax(0, 1fr)', md: 'minmax(0, 2fr) minmax(0, 8fr)' }} gap={{ base: '28px', md: '40px' }} alignItems="start">
    <Box as="aside" aria-label="User settings" minW="0">
      <Heading as="h2" fontSize="12px" fontWeight="500" color="var(--muted)" px="12px" mb="12px">User settings</Heading>
      <Box as="nav" aria-label="Settings navigation" display="flex" flexDirection={{ base: 'row', md: 'column' }} gap="4px">
        {[['/settings/profile', 'Personal profile'], ['/settings/applications', 'Applications']].map(([path, label]) => <PageLink key={path} to={path} aria-current={location.pathname === path ? 'page' : undefined} px="12px" py="10px" borderRadius="6px" fontSize="13px" fontWeight={location.pathname === path ? '500' : '400'} bg={location.pathname === path ? 'var(--surface)' : undefined} _hover={{ bg: 'var(--surface)' }}>{label}</PageLink>)}
      </Box>
    </Box>
    <Box minW="0" key={user.id}><Outlet /></Box>
  </PageContainer>
}
