import {
  Box,
  Button,
  Container,
  Heading,
  HStack,
  Image,
  Stack,
  Text,
} from '@chakra-ui/react'

import heroImage from '../../assets/hero.png'

const HomePage = () => {
  return (
    <Container maxW="7xl" px={{ base: '5', md: '8' }}>
      <Stack
        align="center"
        gap="0"
        minH={{ base: 'auto', lg: 'calc(100vh - 65px)' }}
        pb={{ base: '16', md: '20' }}
        pt={{ base: '16', md: '20', lg: '16' }}
        position="relative"
        textAlign="center"
      >
        <Box mb={{ base: '7', md: '8' }} position="relative" width={{ base: '11rem', md: '13rem' }}>
          <Image
            alt="Enspatium open space"
            position="relative"
            src={heroImage}
            width="full"
          />
        </Box>

        <Text
          border="1px solid"
          borderColor="var(--border)"
          borderRadius="full"
          bg="var(--surface)"
          color="var(--accent-ink)"
          fontSize="xs"
          fontWeight="semibold"
          letterSpacing="0.12em"
          mb="5"
          px="3.5"
          py="1.5"
          textTransform="uppercase"
        >
          One place for everything
        </Text>

        <Heading
          as="h1"
          fontSize={{ base: '4xl', sm: '5xl', md: '6xl', lg: '7xl' }}
          fontWeight="semibold"
          letterSpacing="-0.045em"
          lineHeight="0.98"
        >
          Everything is a{' '}
          <Box as="span" color="var(--accent-ink)">
            Space.
          </Box>
        </Heading>

        <Text
          color="var(--muted)"
          fontSize={{ base: 'md', md: 'lg' }}
          lineHeight="1.8"
          maxW="2xl"
          mt={{ base: '6', md: '7' }}
        >
          Enspatium brings code, files, and knowledge into one spatial model.
        </Text>

        <HStack flexWrap="wrap" gap="3" justify="center" mt="8">
          <Button
            asChild
            bg="var(--foreground)"
            borderRadius="lg"
            color="var(--background)"
            fontWeight="semibold"
            height="11"
            px="5"
            _hover={{ bg: 'var(--accent-ink)', transform: 'translateY(-1px)' }}
          >
            <a href="#spaces">
              Explore
              <Box as="span" aria-hidden="true" ml="1">→</Box>
            </a>
          </Button>
          <Button
            asChild
            bg="transparent"
            border="1px solid"
            borderColor="var(--border)"
            borderRadius="lg"
            color="var(--foreground)"
            fontWeight="medium"
            height="11"
            px="5"
            variant="outline"
            _hover={{ bg: 'var(--surface)' }}
          >
            <a href="#concept">Read the concept</a>
          </Button>
        </HStack>
      </Stack>
    </Container>
  )
}

export default HomePage
