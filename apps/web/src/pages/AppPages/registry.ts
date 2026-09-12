import { mediaPlugin } from './plugins/media'
import { ebookPlugin } from './plugins/ebook'
import type { AppPagePlugin } from './types'

export const appPlugins: readonly AppPagePlugin[] = [mediaPlugin, ebookPlugin]

export function getAppPlugin(type: string | null | undefined) {
  return appPlugins.find(plugin => plugin.type === type)
}

export { appPath } from './paths'
