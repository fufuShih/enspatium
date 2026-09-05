import { Box, Button, Flex, Text, chakra } from '@chakra-ui/react'
import type { FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { PageContainer, PageHeading, PageLink, TextInput } from '../../components/ui/Primitives'
import { useMockAuth } from '../../context/mockAuth'
import { accountFromEmail, namespacePath } from './namespaces'

export default function LoginPage() {
  const { user, signIn } = useMockAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const creatingSpace = location.state?.from === '/space/create'

  if (user) return <Navigate to={creatingSpace ? '/space/create' : namespacePath(user.namespace)} replace />

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const email = String(data.get('email') ?? '')
    signIn(email)
    navigate(creatingSpace ? '/space/create' : namespacePath({ account: accountFromEmail(email) }), { replace: true })
  }

  return (
    <PageContainer as="section" maxW="440px" my={{ base: '48px', md: '72px' }} p="0 20px" borderWidth="1px">
      <PageHeading fontSize="36px" letterSpacing="-.04em">Sign in</PageHeading>
      <Box asChild mt="32px">
        <form onSubmit={handleSubmit}>
          <Flex direction="column">
            <chakra.label htmlFor="login-email" fontSize="13px" fontWeight="500" mb="8px">Email</chakra.label>
            <TextInput id="login-email" name="email" type="email" autoComplete="username" placeholder="you@example.com" required p="12px" mb="20px" fontSize="14px" borderRadius="7px" />
            <chakra.label htmlFor="login-password" fontSize="13px" fontWeight="500" mb="8px">Password</chakra.label>
            <TextInput id="login-password" name="password" type="password" autoComplete="current-password" placeholder="Enter a demo password" required p="12px" mb="20px" fontSize="14px" borderRadius="7px" />
            <Text color="var(--muted)" fontSize="12px" lineHeight="1.8">Demo only. Use any email and password.</Text>
            <Button type="submit" mt="24px" p="12px" height="auto" borderRadius="7px" bg="var(--foreground)" color="var(--background)" fontSize="14px" fontWeight="500" _hover={{ opacity: 0.85 }}>Sign in</Button>
          </Flex>
        </form>
      </Box>
      <PageLink to="/" display="block" width="fit-content" mx="auto" mt="24px" fontSize="13px" color="var(--muted)">Back to home</PageLink>
    </PageContainer>
  )
}
