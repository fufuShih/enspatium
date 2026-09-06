import { Text } from '@chakra-ui/react'
import { useAuth } from '../context/auth'
import { ActionButton, PageContainer } from './ui/Primitives'

export default function AuthStatus() {
  const { error, retry } = useAuth()
  return (
    <PageContainer textAlign="center">
      <Text role="status" color="var(--muted)" fontSize="14px">
        {error ? 'Unable to check your session.' : 'Checking your session...'}
      </Text>
      {error && <ActionButton mt="16px" onClick={retry}>Try again</ActionButton>}
    </PageContainer>
  )
}
