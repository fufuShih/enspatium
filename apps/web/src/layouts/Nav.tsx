import { Box, Button, Container, Flex, HStack, Text } from '@chakra-ui/react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../context/auth'
import UserMenu from './UserMenu'
import CreateMenu from './CreateMenu'
import { demoUser, namespacePath } from '../pages/UserPage/namespaces'
import { PageLink } from '../components/ui/Primitives'

const Nav = () => {
  const { signedIn, user, isLoading, error, retry } = useAuth()
  const navigate = useNavigate()
  return (
    <Box
      as="header"
      bg="var(--background)"
      borderBottom="1px solid"
      borderColor="var(--border)"
      position="sticky"
      top="0"
      zIndex="10"
    >
      <Container maxW="7xl" px={{ base: '5', md: '8' }}>


        <Flex align="center" height="16" justify="space-between" gap="3">
          <Box
            alignItems="center"
            display="inline-flex"
            gap="2.5"
            flexShrink="0"
            textDecoration="none"
            _hover={{ textDecoration: 'none' }}
          >
            <Link to="/">enspatium</Link>
          </Box>
          <HStack gap={{ base: '1', md: '5' }}>
            <PageLink to={namespacePath(user?.namespace ?? demoUser)} fontSize="14px" fontWeight="500">{user ? 'My profile' : 'Explore'}</PageLink>
            {signedIn && <CreateMenu />}
            {signedIn ? <UserMenu /> : <Button
              variant="outline"
              disabled={isLoading}
              size="sm"
              onClick={() => navigate('/login')}
              border="1px solid"
              borderColor="var(--border)"
              borderRadius="md"
              color="var(--foreground)"
              fontSize="sm"
              fontWeight="medium"
              px="3.5"
              py="1.5"
              textDecoration="none"
            >
              {isLoading ? 'Loading...' : 'Sign in'}
            </Button>}
          </HStack>
        </Flex>
        {error && <Flex align="center" justify="flex-end" gap="2" pb="3">
          <Text role="status" fontSize="xs" color="var(--muted)">Unable to check your session.</Text>
          <Button size="xs" variant="ghost" onClick={retry}>Retry</Button>
        </Flex>}
      </Container>
    </Box>
  )
}

export default Nav
