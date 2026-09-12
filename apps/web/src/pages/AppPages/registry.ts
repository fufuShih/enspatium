import { mediaPlugin } from './plugins/media'
import { ebookPlugin } from './plugins/ebook'
import { notePlugin } from './plugins/note'
import type { AppPagePlugin } from './types'

export const appPlugins: readonly AppPagePlugin[] = [mediaPlugin, ebookPlugin, notePlugin]

export function getAppPlugin(type: string | null | undefined) {
  return appPlugins.find(plugin => plugin.type === type)
}

export { appPath } from './paths'
