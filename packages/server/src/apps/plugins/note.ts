import type { ObjectAppPlugin } from '../types.js'

export const notePlugin = {
  type: 'note', storageType: 'object',
  kinds: [
    { kind: 'markdown', contentTypes: ['text/markdown', 'text/x-markdown'], extensions: ['md', 'markdown'], extensionContentTypes: ['application/octet-stream', 'text/plain'], contentType: 'text/markdown' },
  ],
} satisfies ObjectAppPlugin
