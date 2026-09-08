import { Box, Text } from '@chakra-ui/react'
import { useEffect, useState } from 'react'
import { ActionButton } from './Primitives'

export default function CopyButton({ value, label }: { value: string; label: string }) {
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
