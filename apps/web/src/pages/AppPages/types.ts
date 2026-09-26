import type { ComponentType } from 'react'
import type { CreateSpaceBody, GetAppInstance200 } from '../../api/generated/api.schemas'

export type AppInstance = GetAppInstance200
export type AppPageProps = { instance: AppInstance; basePath: string }

export type AppPageRoute = {
  // Relative to /app/:appType/:appId, e.g. book/:bookId or book/:bookId/notes.
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
    loadInstance: (appId: string, signal: AbortSignal) => Promise<AppInstance>
  }
}
