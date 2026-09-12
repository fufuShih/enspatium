import { lazy } from 'react'
import type { AppPagePlugin } from '../../types'
import { ebookIntegration } from './integration'

export const ebookPlugin = {
  type: 'ebook', label: 'Ebook library', builtIn: true,
  view: lazy(() => import('./EbookPage')),
  routes: [{ path: 'book/:bookId', view: lazy(() => import('./BookPage')) }],
  integration: ebookIntegration,
} satisfies AppPagePlugin
