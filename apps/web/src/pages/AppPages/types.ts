import type { ComponentType } from 'react'
import type { CreateSpaceBody } from '../../api/generated/api.schemas'

export type AppSpace = { id: string; name: string; account: string; slug: string }
export type AppPageProps = { space: AppSpace }

// Plugins are local modules compiled with the frontend. The API remains the authority on access.
export type AppPagePlugin = {
  type: NonNullable<CreateSpaceBody['app']>
  label: string
  builtIn: boolean
  view: ComponentType<AppPageProps>
  integration: {
    storageType: CreateSpaceBody['type']
    loadSpace: (spaceId: string, signal: AbortSignal) => Promise<AppSpace>
  }
}
