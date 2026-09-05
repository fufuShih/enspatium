import { Box, Container } from "@chakra-ui/react"
import { Outlet } from "react-router"


const UserLayout = () => {
  return (
    <Container maxW="7xl" px={{ base: '5', md: '8' }}>
      <Outlet />
    </Container>
  )
}

export default UserLayout