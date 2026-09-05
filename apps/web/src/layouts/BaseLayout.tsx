import { Box } from "@chakra-ui/react";
import { Outlet } from 'react-router'

import Nav from "./Nav";

const BaseLayout = () => {
  return (
    <Box display="flex" flexDirection="column" minH="100vh">
      <Nav />

      <Box
        as="main"
        bg="var(--background)"
        color="var(--foreground)"
        flex="1"
        overflow="hidden"
        position="relative"
      >
        <Outlet />
      </Box>
    </Box>
  )
}

export default BaseLayout;
