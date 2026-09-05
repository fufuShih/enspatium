import { Box, Button, Menu, Portal, Text } from '@chakra-ui/react'
import { useNavigate } from 'react-router'
import { useMockAuth } from '../context/mockAuth'

export default function UserMenu() {
  const { user, signOut } = useMockAuth()
  const navigate = useNavigate()

  if (!user) return null

  return (
    <Menu.Root
      positioning={{ placement: 'bottom-end', gutter: 10 }}
      onSelect={({ value }) => {
        if (value === 'sign-out') {
          signOut()
          navigate('/')
        }
      }}
    >
      <Menu.Trigger asChild>
        <Button
          aria-label={`User menu for ${user.name}`}
          variant="ghost"
          size="sm"
          gap="2"
          px="2"
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
            minW="200px"
            maxW="calc(100vw - 32px)"
            bg="var(--background)"
            color="var(--foreground)"
            border="1px solid"
            borderColor="var(--border)"
            borderRadius="lg"
            boxShadow="sm"
            p="1.5"
          >
            <Box px="3" py="3" maxW="280px">
              <Text fontSize="sm" fontWeight="semibold" overflowWrap="anywhere">{user.name}</Text>
              <Text color="var(--muted)" fontSize="xs" mt="1" overflowWrap="anywhere">{user.email}</Text>
            </Box>
            <Menu.Separator borderColor="var(--border)" />
            <Menu.Item
              value="sign-out"
              px="3"
              py="2.5"
              borderRadius="md"
              _highlighted={{ bg: 'var(--surface)' }}
            >
              Sign out
            </Menu.Item>
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  )
}
