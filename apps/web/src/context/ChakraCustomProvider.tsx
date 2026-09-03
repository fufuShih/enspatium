import {
  ChakraProvider,
  defaultSystem,
} from '@chakra-ui/react'
import type { PropsWithChildren } from 'react'

const ChakraCustomProvider = ({ children }: PropsWithChildren) => {
  return (
    <ChakraProvider value={defaultSystem}>
      {children}
    </ChakraProvider>
  )
}

export default ChakraCustomProvider;