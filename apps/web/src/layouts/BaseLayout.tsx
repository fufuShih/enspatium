import { Box } from "@chakra-ui/react";
import { Outlet } from 'react-router'

import Nav from "./Nav";

const BaseLayout = () => {
  return (
    <Box display="flex" flexDirection="column" minH="100vh">
      <Nav />
      <Outlet />
    </Box>
  )
}

export default BaseLayout;
