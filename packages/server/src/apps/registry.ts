import { ebookPlugin } from './plugins/ebook.js'
import { mediaPlugin } from './plugins/media.js'
import { notePlugin } from './plugins/note.js'
import type { ObjectAppPlugin } from './types.js'

// Bundled server plugins, never code loaded from a database or upload.
export const objectAppPlugins: readonly ObjectAppPlugin[] = [mediaPlugin, ebookPlugin, notePlugin]

export function getObjectAppPlugin(type: string) {
  return objectAppPlugins.find(plugin => plugin.type === type)
}
