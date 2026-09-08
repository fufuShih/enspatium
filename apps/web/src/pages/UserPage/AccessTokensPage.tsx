import { Box, Flex, Heading, Text, chakra } from '@chakra-ui/react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate } from 'react-router'
import type { CreatePersonalAccessToken201 } from '../../api/generated/api.schemas'
import { createPersonalAccessToken, getListPersonalAccessTokensQueryKey, revokePersonalAccessToken, useListPersonalAccessTokens } from '../../api/generated/tokens'
import AuthStatus from '../../components/AuthStatus'
import RequestState from '../../components/RequestState'
import CopyButton from '../../components/ui/CopyButton'
import { ActionButton, PageContainer, PageHeading, SelectInput, TextInput } from '../../components/ui/Primitives'
import { useAuth } from '../../context/auth'
import { apiStatus } from '../../context/session'
import { accessTokensPath, newTokenInput, tokenErrorMessage, tokenStatus } from './tokenApi'

export default function AccessTokensPage() {
  const { user, isLoading, error } = useAuth()
  if (isLoading || (error && !user)) return <AuthStatus />
  if (!user) return <Navigate to="/login" replace state={{ from: accessTokensPath }} />
  return <TokenSettings key={user.id} userId={user.id} />
}

function TokenSettings({ userId }: { userId: string }) {
  const client = useQueryClient()
  const tokens = useListPersonalAccessTokens({ query: { retry: false, queryKey: [...getListPersonalAccessTokensQueryKey(), userId] } })
  const request = useRef<AbortController | null>(null)
  const secretInput = useRef<HTMLInputElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [permission, setPermission] = useState('read')
  const [days, setDays] = useState('30')
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  // Keep the one-time secret out of Query/Mutation caches, URLs and browser storage.
  const [created, setCreated] = useState<Pick<CreatePersonalAccessToken201, 'id' | 'token'> | null>(null)

  useEffect(() => () => { request.current?.abort() }, [])
  useEffect(() => { if (created) secretInput.current?.focus() }, [created])
  useEffect(() => {
    if (apiStatus(tokens.error) === 401) void client.invalidateQueries({ queryKey: ['session'] })
  }, [tokens.error, client])

  async function handleError(failure: unknown) {
    setError(tokenErrorMessage(failure))
    if (apiStatus(failure) === 401) await client.invalidateQueries({ queryKey: ['session'] })
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (request.current || created) return
    if (!name.trim()) { setError('Please enter a token name.'); return }
    const controller = new AbortController()
    request.current = controller
    setPending('create'); setError(''); setNotice('')
    try {
      const token = await createPersonalAccessToken(newTokenInput(name, permission === 'write', Number(days)), { signal: controller.signal })
      if (controller.signal.aborted) return
      setCreated({ id: token.id, token: token.token })
      setName('')
      await client.invalidateQueries({ queryKey: getListPersonalAccessTokensQueryKey() })
    } catch (failure) {
      if (!controller.signal.aborted) await handleError(failure)
    } finally {
      if (!controller.signal.aborted) { request.current = null; setPending(null) }
    }
  }

  async function revoke(id: string) {
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    setPending(id); setError(''); setNotice('')
    try {
      await revokePersonalAccessToken(id, { signal: controller.signal })
      if (controller.signal.aborted) return
      if (created?.id === id) setCreated(null)
      setConfirmId(null)
      setNotice('Token revoked. It can no longer be used to access Git.')
      client.setQueryData(tokens.queryKey, (old: typeof tokens.data) => old?.map(token => token.id === id ? { ...token, revokedAt: new Date().toISOString() } : token))
      await client.invalidateQueries({ queryKey: getListPersonalAccessTokensQueryKey() })
    } catch (failure) {
      if (!controller.signal.aborted) await handleError(failure)
    } finally {
      if (!controller.signal.aborted) { request.current = null; setPending(null) }
    }
  }

  return <PageContainer maxW="800px">
    <PageHeading>Access tokens</PageHeading>
    <Text mt="10px" mb="28px" fontSize="14px" color="var(--muted)" lineHeight="1.7">Use a token as your password to clone and push Git repositories.</Text>
    {created ? <Box as="section" aria-label="New access token" mb="28px" p={{ base: '20px', md: '24px' }} border="1px solid var(--border)" borderRadius="8px">
      <Heading as="h2" fontSize="17px" fontWeight="500">Your token is ready</Heading>
      <Text mt="8px" mb="16px" fontSize="13px" color="var(--muted)">Copy it now. You will not be able to view it again after leaving this page or selecting Done.</Text>
      <Flex gap="8px" align="start"><TextInput ref={secretInput} aria-label="New access token" value={created.token} readOnly onFocus={event => event.currentTarget.select()} autoComplete="off" spellCheck={false} fontFamily="mono" minW="0" /><CopyButton value={created.token} label="Copy access token" /></Flex>
      <ActionButton mt="16px" onClick={() => { setCreated(null); window.requestAnimationFrame(() => nameInput.current?.focus()) }}>Done</ActionButton>
    </Box> : <Box asChild mb="28px" p={{ base: '20px', md: '24px' }} border="1px solid var(--border)" borderRadius="8px">
      <form onSubmit={create} aria-busy={pending === 'create'}>
        <Heading as="h2" fontSize="17px" fontWeight="500" mb="20px">Create token</Heading>
        <chakra.fieldset disabled={pending !== null} border="0" p="0" m="0" minW="0">
          <chakra.label htmlFor="token-name" display="block" fontSize="13px" mb="8px">Name</chakra.label>
          <TextInput ref={nameInput} id="token-name" value={name} onChange={event => { setName(event.target.value); setError('') }} placeholder="My laptop" required maxLength={100} autoComplete="off" />
          <Flex gap="16px" mt="20px" direction={{ base: 'column', sm: 'row' }}>
            <Box flex="1"><chakra.label htmlFor="token-permission" display="block" fontSize="13px" mb="8px">Permissions</chakra.label><SelectInput id="token-permission" value={permission} onChange={event => setPermission(event.target.value)}><option value="read">Read only — clone and fetch</option><option value="write">Read and write — clone, fetch and push</option></SelectInput></Box>
            <Box w={{ base: '100%', sm: '160px' }}><chakra.label htmlFor="token-expiration" display="block" fontSize="13px" mb="8px">Expires in</chakra.label><SelectInput id="token-expiration" value={days} onChange={event => setDays(event.target.value)}><option value="30">30 days</option><option value="90">90 days</option><option value="0">No expiration</option></SelectInput></Box>
          </Flex>
          <Text mt="12px" fontSize="12px" color="var(--muted)">Tokens use your existing Space permissions.</Text>
          <Flex justify="flex-end" mt="20px"><ActionButton type="submit" loading={pending === 'create'} loadingText="Creating..." bg="var(--foreground)" color="var(--background)">Create token</ActionButton></Flex>
        </chakra.fieldset>
      </form>
    </Box>}
    {error && <Text role="alert" mb="20px" p="12px 14px" borderRadius="8px" fontSize="13px" bg="bg.error" color="fg.error">{error}</Text>}
    {notice && <Text role="status" mb="20px" fontSize="13px" color="var(--muted)">{notice}</Text>}
    <Heading as="h2" fontSize="17px" fontWeight="500" mb="16px">Your tokens</Heading>
    {tokens.isPending ? <RequestState loading title="Loading tokens..." /> : tokens.isError ? <RequestState title="Unable to load tokens" message={tokenErrorMessage(tokens.error)} onRetry={() => { void tokens.refetch() }} /> : !tokens.data.length ? <RequestState title="No access tokens yet" message="Create a token to connect your Git client." /> : <Box as="ul" listStyleType="none" m="0" p="0" border="1px solid var(--border)" borderRadius="8px" overflow="hidden">
      {tokens.data.map(token => <Box as="li" key={token.id} p="20px" _notFirst={{ borderTop: '1px solid var(--border)' }}>
        <Flex align="start" justify="space-between" gap="16px"><Box minW="0">
          <Flex gap="10px" align="center" wrap="wrap"><Text fontSize="14px" fontWeight="500" overflowWrap="anywhere">{token.name}</Text><Text fontSize="11px" color="var(--muted)" border="1px solid var(--border)" borderRadius="full" px="8px" py="2px">{tokenStatus(token)}</Text></Flex>
          <Text mt="8px" fontSize="12px" color="var(--muted)">{token.scopes.includes('git:write') ? token.scopes.includes('git:read') ? 'Git read and write' : 'Git write only' : 'Git read only'}</Text>
          <Text mt="6px" fontSize="12px" color="var(--muted)" lineHeight="1.8">Created {new Date(token.createdAt).toLocaleDateString('en-US')} · {token.expiresAt ? `Expires ${new Date(token.expiresAt).toLocaleDateString('en-US')}` : 'No expiration'}<br />{token.lastUsedAt ? `Last used ${new Date(token.lastUsedAt).toLocaleString('en-US')}` : 'Never used'}</Text>
        </Box>{!token.revokedAt && confirmId !== token.id && <ActionButton disabled={pending !== null} aria-label={`Revoke ${token.name}`} onClick={() => { setConfirmId(token.id); setError('') }}>Revoke</ActionButton>}</Flex>
        {confirmId === token.id && <Box mt="16px" pt="16px" borderTop="1px solid var(--border)"><Text fontSize="13px" mb="12px">Revoke this token? Git clients using it will lose access immediately.</Text><Flex gap="10px" justify="flex-end"><ActionButton disabled={pending !== null} onClick={() => setConfirmId(null)}>Cancel</ActionButton><ActionButton disabled={pending !== null && pending !== token.id} loading={pending === token.id} loadingText="Revoking..." onClick={() => { void revoke(token.id) }}>Revoke token</ActionButton></Flex></Box>}
      </Box>)}
    </Box>}
  </PageContainer>
}
