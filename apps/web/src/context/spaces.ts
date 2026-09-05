import { createContext, useContext } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Space } from '../pages/SpacesPage/spaceData'

export const SpacesContext = createContext<{
  spaces: Space[]
  setSpaces: Dispatch<SetStateAction<Space[]>>
} | null>(null)

export function useSpaces() {
  const context = useContext(SpacesContext)
  if (!context) throw new Error('useSpaces must be used within SpacesProvider')
  return context
}
