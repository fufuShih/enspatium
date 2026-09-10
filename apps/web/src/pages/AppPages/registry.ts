import { mediaPlugin } from './plugins/media'
import type { AppPagePlugin } from './types'

export const appPlugins: readonly AppPagePlugin[] = [mediaPlugin]

export function getAppPlugin(type: string | null | undefined) {
  return appPlugins.find(plugin => plugin.type === type)
}

export function appPath(type: AppPagePlugin['type'], spaceId: string) {
  return `/app/${encodeURIComponent(type)}/${encodeURIComponent(spaceId)}`
}
