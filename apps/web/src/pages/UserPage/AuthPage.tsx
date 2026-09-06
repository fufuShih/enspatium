import { Box, Button, Text, chakra } from '@chakra-ui/react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { useCreateUser } from '../../api/generated/users'
import AuthStatus from '../../components/AuthStatus'
import { PageContainer, PageHeading, PageLink, TextInput } from '../../components/ui/Primitives'
import { useAuth } from '../../context/auth'
import { authErrorMessage } from '../../context/session'
import { namespacePath } from './namespaces'

export default function AuthPage({ register = false }: { register?: boolean }) {
  const { user, isLoading, signIn } = useAuth()
  const createUser = useCreateUser({ mutation: { gcTime: 0, retry: false } })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const creatingSpace = location.state?.from === '/space/create'
  const title = register ? 'Create account' : 'Sign in'

  if (isLoading) return <AuthStatus />
  if (user) return <Navigate to={creatingSpace ? '/space/create' : namespacePath(user.namespace)} replace />

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    const data = new FormData(event.currentTarget)
    const email = String(data.get('email') ?? '').trim()
    const password = String(data.get('password') ?? '')
    const displayName = String(data.get('displayName') ?? '').trim()
    setError('')
    if (register && !displayName) {
      setError('Please enter your name.')
      return
    }
    setSubmitting(true)
    try {
      if (register) {
        await createUser.mutateAsync({ data: { email, password, displayName } })
        navigate('/login', { replace: true, state: { registered: true, email, from: creatingSpace ? '/space/create' : undefined } })
      } else {
        await signIn({ email, password })
        // The authenticated render redirects using the backend's namespace slug.
      }
    } catch (failure) {
      setError(authErrorMessage(failure, register ? 'register' : 'login'))
    } finally {
      setSubmitting(false)
      createUser.reset()
    }
  }

  return (
    <PageContainer as="section" maxW="440px" my={{ base: '32px', md: '64px' }}>
      <PageHeading fontSize="32px">{title}</PageHeading>
      {!register && location.state?.registered && (
        <Text role="status" mt="16px" fontSize="14px" color="var(--muted)">Account created. Sign in to continue.</Text>
      )}
      <Box asChild mt="28px">
        <form onSubmit={handleSubmit} aria-busy={submitting}>
          <chakra.fieldset display="flex" flexDirection="column" disabled={submitting} border="0" p="0" m="0" minW="0" gap="8px">
            {register && <>
              <chakra.label htmlFor="auth-name" fontSize="13px" fontWeight="500">Name</chakra.label>
              <TextInput id="auth-name" name="displayName" autoComplete="name" placeholder="Your name" required maxLength={100} mb="12px" />
            </>}
            <chakra.label htmlFor="auth-email" fontSize="13px" fontWeight="500">Email</chakra.label>
            <TextInput id="auth-email" name="email" type="email" autoComplete="username" placeholder="you@example.com" required maxLength={320} mb="12px" defaultValue={register ? '' : location.state?.email ?? ''} />
            <chakra.label htmlFor="auth-password" fontSize="13px" fontWeight="500">Password</chakra.label>
            <TextInput id="auth-password" name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} placeholder={register ? 'At least 8 characters' : 'Enter your password'} required minLength={register ? 8 : 1} maxLength={1024} aria-describedby={error ? 'auth-error' : undefined} />
            {error && <Text id="auth-error" role="alert" color="#bd4940" fontSize="13px" mt="8px">{error}</Text>}
            <Button type="submit" loading={submitting} loadingText={register ? 'Creating account...' : 'Signing in...'} mt="16px" height="auto" p="12px" borderRadius="7px" bg="var(--foreground)" color="var(--background)" fontSize="14px" fontWeight="500" _hover={{ opacity: 0.85 }}>{title}</Button>
          </chakra.fieldset>
        </form>
      </Box>
      <Text mt="24px" fontSize="13px" color="var(--muted)" textAlign="center">
        {register ? 'Already have an account? ' : "Don't have an account? "}
        <PageLink to={register ? '/login' : '/register'} state={{ from: creatingSpace ? '/space/create' : undefined }} color="var(--foreground)" fontWeight="500">{register ? 'Sign in' : 'Create account'}</PageLink>
      </Text>
    </PageContainer>
  )
}
