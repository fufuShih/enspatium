import { Box, Button, Menu, Portal, Text } from '@chakra-ui/react'
import { useNavigate } from 'react-router'
import { useState } from 'react'
import { useAuth } from '../context/auth'
import { authErrorMessage } from '../context/session'

export default function UserMenu() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  if (!user) return null

  async function handleSignOut() {
    if (pending) return
    setPending(true)
    setError('')
    try {
      await signOut()
      navigate('/', { replace: true, flushSync: true })
    } catch (failure) {
      setError(authErrorMessage(failure, 'logout'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Menu.Root
      closeOnSelect={false}
      positioning={{ placement: 'bottom-end', gutter: 10 }}
      onSelect={({ value }) => {
        if (value === 'sign-out') {
          void handleSignOut()
        }
      }}
    >
      <Menu.Trigger asChild>
        <Button
          aria-label={`User menu for ${user.name}`}
          variant="ghost"
          size="sm"
          gap="2"
          px="2.5"
          h="10"
          borderRadius="full"
          color="var(--foreground)"
          _hover={{ bg: 'var(--surface)' }}
          _open={{ bg: 'var(--surface)' }}
        >
          <Box
            as="span"
            aria-hidden="true"
            display="grid"
            placeItems="center"
            boxSize="8"
            flexShrink="0"
            borderRadius="full"
            bg="var(--surface-strong)"
            fontSize="sm"
            fontWeight="semibold"
          >
            {Array.from(user.name)[0]?.toUpperCase()}
          </Box>
          <Box as="span" display={{ base: 'none', md: 'inline' }} maxW="28" truncate>
            {user.name}
          </Box>
          <Box as="span" aria-hidden="true" fontSize="xs" color="var(--muted)">▾</Box>
        </Button>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content
            aria-label="User account"
            minW="240px"
            maxW="calc(100vw - 32px)"
            bg="var(--background)"
            color="var(--foreground)"
            border="1px solid"
            borderColor="color-mix(in srgb, var(--border) 65%, transparent)"
            borderRadius="12px"
            boxShadow="0 8px 32px rgb(0 0 0 / 8%)"
            p="1.5"
          >
            <Box px="3" py="3" maxW="280px">
              <Text fontSize="sm" fontWeight="semibold" overflowWrap="anywhere">{user.name}</Text>
              <Text color="var(--muted)" fontSize="xs" mt="1" overflowWrap="anywhere">{user.email}</Text>
            </Box>
            <Menu.Separator borderColor="var(--border)" />
            <Menu.Item
              value="sign-out"
              disabled={pending}
              px="3"
              py="2.5"
              borderRadius="md"
              _highlighted={{ bg: 'var(--surface)' }}
            >
              {pending ? 'Signing out...' : 'Sign out'}
            </Menu.Item>
            {error && <Text role="alert" m="1" px="3" py="2.5" maxW="240px" bg="bg.error" color="fg.error" borderRadius="7px" lineHeight="1.7" fontSize="xs">{error}</Text>}
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  )
}
