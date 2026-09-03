import { Box, Button, Heading, Stack, Text } from '@chakra-ui/react'


const HomePage = () => {
  return (
    <Box id="main" bg="bg" color="fg" padding="8">
      <Stack gap="4">
        <Heading>Enspatium</Heading>
        <Text>Chakra UI is ready.</Text>
        <Button colorPalette="purple" width="fit-content">
          Continue
        </Button>
      </Stack>
    </Box>
  )
}

export default HomePage