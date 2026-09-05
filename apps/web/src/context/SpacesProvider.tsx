import { useState } from 'react'
import type { PropsWithChildren } from 'react'
import { initialSpaces } from '../pages/SpacesPage/spaceData'
import { SpacesContext } from './spaces'

export default function SpacesProvider({ children }: PropsWithChildren) {
  const [spaces, setSpaces] = useState(initialSpaces)

  return <SpacesContext.Provider value={{ spaces, setSpaces }}>{children}</SpacesContext.Provider>
}
