import { Box, Button, Menu, Portal } from '@chakra-ui/react'
import { useNavigate } from 'react-router'

export default function CreateMenu() {
  const navigate = useNavigate()

  return (
    <Menu.Root
      positioning={{ placement: 'bottom-end', gutter: 10 }}
      onSelect={({ value }) => {
        if (value === 'space') navigate('/space/create')
      }}
    >
      <Menu.Trigger asChild>
        <Button
          aria-label="Create menu"
          variant="ghost"
          size="sm"
          px="2"
          gap="1"
          color="var(--foreground)"
          _hover={{ bg: 'var(--surface)' }}
          _open={{ bg: 'var(--surface)' }}
        >
          <Box as="span" aria-hidden="true" fontSize="xl">+</Box>
          <Box as="span" aria-hidden="true" fontSize="xs" color="var(--muted)">▾</Box>
        </Button>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content
            aria-label="Create"
            minW="180px"
            bg="var(--background)"
            color="var(--foreground)"
            border="1px solid"
            borderColor="var(--border)"
            borderRadius="lg"
            boxShadow="sm"
            p="1.5"
          >
            <Menu.Item value="space" px="3" py="2.5" borderRadius="md" _highlighted={{ bg: 'var(--surface)' }}>
              Create Space
            </Menu.Item>
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  )
}
