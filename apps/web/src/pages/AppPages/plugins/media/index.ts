import { lazy } from 'react'
import type { AppPagePlugin } from '../../types'
import { mediaIntegration } from './integration'

export const mediaPlugin = {
  type: 'media',
  label: 'Media',
  builtIn: true,
  view: lazy(() => import('./MediaPage')),
  integration: mediaIntegration,
} satisfies AppPagePlugin
