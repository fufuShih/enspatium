import type { ObjectAppPlugin } from '../types.js'
import { objectFolderContentType } from '../../services/object/folders.js'

export const notePlugin = {
  type: 'note', storageType: 'object',
  kinds: [
    { kind: 'folder', contentTypes: [objectFolderContentType] },
    { kind: 'markdown', contentTypes: ['text/markdown', 'text/x-markdown'], extensions: ['md', 'markdown'], extensionContentTypes: ['application/octet-stream', 'text/plain'], contentType: 'text/markdown' },
  ],
} satisfies ObjectAppPlugin
