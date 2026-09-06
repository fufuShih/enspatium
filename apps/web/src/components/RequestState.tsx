import { Box, Heading, Spinner, Text } from '@chakra-ui/react'
import type { ReactNode } from 'react'
import { ActionButton } from './ui/Primitives'

export default function RequestState({ title, message, loading, onRetry, children }: {
  title: string
  message?: string
  loading?: boolean
  onRetry?: () => void
  children?: ReactNode
}) {
  return (
    <Box py="48px" px="16px" textAlign="center" role={loading ? 'status' : undefined}>
      {loading && <Spinner size="md" mb="16px" color="var(--muted)" />}
      <Heading as="h2" fontSize="17px" fontWeight="500">{title}</Heading>
      {message && <Text mt="10px" fontSize="13px" color="var(--muted)" lineHeight="1.8">{message}</Text>}
      {onRetry && <ActionButton mt="20px" onClick={onRetry}>Try again</ActionButton>}
      {children}
    </Box>
  )
}
