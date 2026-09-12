import { Box, Button, Text, chakra } from '@chakra-ui/react'
import type { InputProps } from '@chakra-ui/react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { useCreateUser } from '../../api/generated/users'
import { useGetAuthSettings } from '../../api/generated/auth'
import RequestState from '../../components/RequestState'
import AuthStatus from '../../components/AuthStatus'
import { PageContainer, PageHeading, PageLink, TextInput } from '../../components/ui/Primitives'
import { useAuth } from '../../context/auth'
import { authErrorMessage, authReturnPath } from '../../context/session'
import { namespacePath } from './namespaces'

function AuthInput(props: InputProps) {
  return <TextInput h="46px" fontSize="14px" borderRadius="8px" borderColor="color-mix(in srgb, var(--border) 75%, transparent)" _placeholder={{ color: 'var(--muted)', opacity: 0.7 }} _hover={{ borderColor: 'var(--muted)' }} _focusVisible={{ outline: 'none', borderColor: 'var(--foreground)', boxShadow: '0 0 0 3px color-mix(in srgb, var(--foreground) 8%, transparent)' }} {...props} />
}

export default function AuthPage({ register = false }: { register?: boolean }) {
  const { user, isLoading, signIn } = useAuth()
  const settings = useGetAuthSettings({ query: { retry: false } })
  const createUser = useCreateUser({ mutation: { gcTime: 0, retry: false } })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = authReturnPath(location.state?.from)
  const title = register ? 'Create account' : 'Sign in'

  if (isLoading) return <AuthStatus />
  if (user) return <Navigate to={returnTo ?? namespacePath(user.namespace)} replace />
  if (register && settings.isPending) return <PageContainer><RequestState loading title="Loading registration..." /></PageContainer>
  if (register && settings.isError) return <PageContainer><RequestState title="Unable to load registration" onRetry={() => { void settings.refetch() }} /></PageContainer>
  if (register && !settings.data?.registrationEnabled) return <PageContainer><RequestState title="Registration is closed" message="Contact the site administrator to request an account."><PageLink display="inline-block" mt="20px" to="/login">Sign in</PageLink></RequestState></PageContainer>

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
        navigate('/login', { replace: true, state: { registered: true, email, from: returnTo } })
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
    <PageContainer as="section" maxW="480px" px={{ base: '20px', md: '24px' }} pt={{ base: '48px', md: '80px' }} pb="64px" css={{ '& :is(a, button):focus-visible': { outline: '2px solid var(--muted)', outlineOffset: '3px' } }}>
      <Box textAlign="center" mb="28px">
        <PageHeading fontSize={{ base: '28px', md: '32px' }}>{title}</PageHeading>
        <Text mt="10px" fontSize="14px" lineHeight="1.6" color="var(--muted)">
          {register ? 'A place for your projects, all your own.' : 'Welcome back to your space.'}
        </Text>
      </Box>
      <Box asChild p={{ base: '24px', md: '32px' }} bg="var(--background)" border="1px solid" borderColor="color-mix(in srgb, var(--border) 60%, transparent)" borderRadius="14px" boxShadow="0 4px 24px rgb(0 0 0 / 3%)">
        <form onSubmit={handleSubmit} onChange={() => { if (error) setError('') }} aria-busy={submitting}>
          {!register && location.state?.registered && (
            <Text role="status" mb="24px" p="12px 14px" borderRadius="8px" bg="bg.success" color="fg.success" fontSize="13px" lineHeight="1.7">Account created. Sign in to continue.</Text>
          )}
          <chakra.fieldset display="flex" flexDirection="column" disabled={submitting} border="0" p="0" m="0" minW="0" gap="20px">
            {register && <Box>
              <chakra.label display="block" mb="8px" htmlFor="auth-name" fontSize="13px" fontWeight="500">Name</chakra.label>
              <AuthInput id="auth-name" name="displayName" autoComplete="name" placeholder="Your name" required maxLength={100} />
            </Box>}
            <Box>
              <chakra.label display="block" mb="8px" htmlFor="auth-email" fontSize="13px" fontWeight="500">Email</chakra.label>
              <AuthInput id="auth-email" name="email" type="email" autoComplete="username" placeholder="you@example.com" required maxLength={320} defaultValue={register ? '' : location.state?.email ?? ''} />
            </Box>
            <Box>
              <chakra.label display="block" mb="8px" htmlFor="auth-password" fontSize="13px" fontWeight="500">Password</chakra.label>
              <Box position="relative">
                <AuthInput id="auth-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} placeholder={register ? 'Create a password' : 'Enter your password'} required minLength={register ? 8 : 1} maxLength={1024} pr="64px" aria-describedby={[register && 'password-hint', error && 'auth-error'].filter(Boolean).join(' ') || undefined} />
                <Button type="button" variant="plain" position="absolute" right="4px" top="4px" h="38px" minW="52px" px="8px" fontSize="12px" fontWeight="500" color="var(--muted)" borderRadius="6px" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-controls="auth-password" onClick={() => setShowPassword(value => !value)} _hover={{ bg: 'var(--surface)', color: 'var(--foreground)' }}>
                  {showPassword ? 'Hide' : 'Show'}
                </Button>
              </Box>
              {register && <Text id="password-hint" mt="8px" fontSize="12px" color="var(--muted)">Use at least 8 characters.</Text>}
            </Box>
            {error && <Text id="auth-error" role="alert" bg="bg.error" color="fg.error" p="12px 14px" borderRadius="8px" fontSize="13px" lineHeight="1.7">{error}</Text>}
            <Button type="submit" loading={submitting} loadingText={register ? 'Creating account...' : 'Signing in...'} mt="4px" h="46px" borderRadius="8px" bg="var(--foreground)" color="var(--background)" fontSize="14px" fontWeight="500" _hover={{ opacity: 0.9 }} _active={{ opacity: 0.8 }}>{title}</Button>
          </chakra.fieldset>
        </form>
      </Box>
      {(register || settings.data?.registrationEnabled) && <Text mt="24px" fontSize="13px" lineHeight="1.8" color="var(--muted)" textAlign="center">
        {register ? 'Already have an account? ' : "Don't have an account? "}
        <PageLink to={register ? '/login' : '/register'} state={{ from: returnTo }} color="var(--foreground)" fontWeight="500" textDecoration="underline" textUnderlineOffset="3px" textDecorationColor="var(--border)">{register ? 'Sign in' : 'Create account'}</PageLink>
      </Text>}
    </PageContainer>
  )
}
