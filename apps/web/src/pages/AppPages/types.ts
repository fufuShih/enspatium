import type { ComponentType } from 'react'
import type { CreateSpaceBody } from '../../api/generated/api.schemas'

export type AppSpace = { id: string; name: string; account: string; slug: string }
export type AppPageProps = { space: AppSpace; basePath: string }

export type AppPageRoute = {
  // Relative to /app/:appType/:spaceId, e.g. book/:bookId or book/:bookId/notes.
  path: string
  view: ComponentType<AppPageProps>
}

// Plugins are local modules compiled with the frontend. The API remains the authority on access.
export type AppPagePlugin = {
  type: NonNullable<CreateSpaceBody['app']>
  label: string
  builtIn: boolean
  view: ComponentType<AppPageProps>
  routes?: readonly AppPageRoute[]
  integration: {
    storageType: CreateSpaceBody['type']
    loadSpace: (spaceId: string, signal: AbortSignal) => Promise<AppSpace>
  }
}
