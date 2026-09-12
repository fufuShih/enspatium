import { lazy } from 'react'
import type { AppPagePlugin } from '../../types'
import { noteIntegration } from './integration'

const NotePage = lazy(() => import('./NotePage'))

export const notePlugin = {
  type: 'note', label: 'Note', builtIn: true,
  view: NotePage,
  routes: [{ path: 'note/:noteId', view: NotePage }],
  integration: noteIntegration,
} satisfies AppPagePlugin
