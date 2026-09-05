import { Box, Container, Flex, HStack } from '@chakra-ui/react'

const Nav = () => {
  return (
    <Box
      as="header"
      bg="var(--background)"
      borderBottom="1px solid"
      borderColor="var(--border)"
      position="sticky"
      top="0"
      zIndex="10"
    >
      <Container maxW="7xl" px={{ base: '5', md: '8' }}>


        <Flex align="center" height="16" justify="space-between">
          <Box
            alignItems="center"
            display="inline-flex"
            gap="2.5"
            textDecoration="none"
            _hover={{ textDecoration: 'none' }}
          >
            enspatium
          </Box>
          <HStack gap={{ base: '4', md: '7' }}>
            <Box
              color="var(--muted)"
              fontSize="sm"
              fontWeight="medium"
            >
              Explore
            </Box>
            <Box
              color="var(--muted)"
              display={{ base: 'none', sm: 'inline-flex' }}
              fontSize="sm"
              fontWeight="medium"
              textDecoration="none"
            >
              Concept
            </Box>
            <Box
              border="1px solid"
              borderColor="var(--border)"
              borderRadius="md"
              color="var(--foreground)"
              fontSize="sm"
              fontWeight="medium"
              px="3.5"
              py="1.5"
              textDecoration="none"
            >
              Sign in
            </Box>
          </HStack>
        </Flex>
      </Container>
    </Box>
  )
}

export default Nav
