import { Flex, Spinner, Text } from '@chakra-ui/react'
import { useAuth } from '../context/auth'
import { ActionButton, PageContainer } from './ui/Primitives'

export default function AuthStatus() {
  const { error, retry } = useAuth()
  return (
    <PageContainer textAlign="center" maxW="440px" py={{ base: '72px', md: '112px' }}>
      <Flex role="status" direction="column" align="center" gap="16px">
        {!error && <Spinner size="md" color="var(--muted)" borderWidth="2px" />}
        <Text color="var(--muted)" fontSize="14px" lineHeight="1.7">
          {error ? 'Unable to check your session.' : 'Checking your session...'}
        </Text>
      </Flex>
      {error && <ActionButton mt="20px" onClick={retry}>Try again</ActionButton>}
    </PageContainer>
  )
}
