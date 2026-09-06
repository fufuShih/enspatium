import { Box, Flex, Heading, Popover, Portal, Text } from '@chakra-ui/react'
import { useEffect, useState } from 'react'
import { ActionButton, TextInput } from '../../components/ui/Primitives'

function CopyButton({ value, label }: { value: string; label: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (status === 'idle') return
    const timer = window.setTimeout(() => setStatus('idle'), 3000)
    return () => window.clearTimeout(timer)
  }, [status])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setStatus('copied')
    } catch {
      setStatus('failed')
    }
  }

  return <Box flexShrink="0">
    <ActionButton aria-label={label} onClick={() => { void copy() }} fontSize="12px" px="12px">{status === 'copied' ? 'Copied!' : 'Copy'}</ActionButton>
    <Text role="status" srOnly={status !== 'failed'} fontSize="12px" color="var(--muted)" mt={status === 'failed' ? '8px' : '0'} maxW="160px">{status === 'failed' ? 'Select and copy the text manually.' : status === 'copied' ? 'Copied to clipboard.' : ''}</Text>
  </Box>
}

export function GitCloneMenu({ url }: { url: string }) {
  return (
    <Popover.Root positioning={{ placement: 'bottom-end', gutter: 8 }} lazyMount unmountOnExit>
      <Popover.Trigger asChild>
        <ActionButton bg="var(--foreground)" color="var(--background)" gap="10px">Clone</ActionButton>
      </Popover.Trigger>
      <Portal>
        <Popover.Positioner>
          <Popover.Content w="400px" maxW="calc(100vw - 32px)" p="20px" bg="var(--background)" color="var(--foreground)" border="1px solid var(--border)" borderRadius="8px" boxShadow="lg" css={{ '& :is(button, input):focus-visible': { outline: '2px solid var(--muted)', outlineOffset: '3px' } }}>
            <Popover.Title fontSize="14px" fontWeight="600" mb="12px">Clone with {url.startsWith('https:') ? 'HTTPS' : 'HTTP'}</Popover.Title>
            <Flex gap="8px" align="start">
              <TextInput aria-label="Clone URL" value={url} readOnly onFocus={event => event.currentTarget.select()} fontFamily="mono" fontSize="12px" minW="0" />
              <CopyButton value={url} label="Copy clone URL" />
            </Flex>
            <Popover.Description mt="12px" fontSize="12px" lineHeight="1.7" color="var(--muted)">Use an access token as your password when Git asks you to sign in.</Popover.Description>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  )
}

export function EmptyGitRepository({ url, refreshing, onRefresh }: { url: string; refreshing: boolean; onRefresh: () => void }) {
  const command = `git push "${url}" HEAD:main`
  return (
    <Box as="section" aria-label="Repository setup" border="1px solid var(--border)" borderRadius="8px" p={{ base: '20px', md: '28px' }}>
      <Heading as="h2" fontSize="18px" fontWeight="500">Push your first commit</Heading>
      <Text mt="8px" fontSize="13px" lineHeight="1.8" color="var(--muted)">Run this in a local repository with at least one commit to add your files.</Text>
      <Box mt="20px" border="1px solid var(--border)" borderRadius="6px" overflow="hidden">
        <Flex align="center" justify="space-between" gap="12px" px="14px" py="8px" bg="var(--surface)">
          <Text fontSize="12px" color="var(--muted)">Push to main</Text>
          <CopyButton value={command} label="Copy push command" />
        </Flex>
        <Box as="pre" aria-label="Push command" m="0" p="16px" fontFamily="mono" fontSize="12px" lineHeight="1.8" whiteSpace="pre-wrap" overflowWrap="anywhere" tabIndex={0}>{command}</Box>
      </Box>
      <Flex mt="20px" gap="16px" align="center" justify="space-between" wrap="wrap">
        <Text fontSize="12px" color="var(--muted)" lineHeight="1.7">When prompted, use an access token with Git write access as your password.</Text>
        <ActionButton loading={refreshing} loadingText="Refreshing..." onClick={onRefresh}>Refresh files</ActionButton>
      </Flex>
    </Box>
  )
}
