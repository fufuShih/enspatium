import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { router } from './router'
import { RouterProvider } from 'react-router/dom'
import { queryClient } from './queryClient'

import ChakraCustomProvider from './context/ChakraCustomProvider'
import ThemeModeProvider from './context/ThemeModeProvider'
import MockAuthProvider from './context/MockAuthProvider'
import SpacesProvider from './context/SpacesProvider'

import './styles/theme.css'
import './styles/index.css'

const App = () => {
  return (
    <StrictMode>
      <ChakraCustomProvider>
        <ThemeModeProvider>
          <QueryClientProvider client={queryClient}>
            <MockAuthProvider>
              <SpacesProvider>
                <RouterProvider router={router} />
              </SpacesProvider>
            </MockAuthProvider>
          </QueryClientProvider>
        </ThemeModeProvider>
      </ChakraCustomProvider>
    </StrictMode>
  )
}

createRoot(document.getElementById('root')!).render(
  <App />,
)
