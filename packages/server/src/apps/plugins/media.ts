import type { ObjectAppPlugin } from '../types.js'

export const mediaPlugin = {
  type: 'media', storageType: 'object',
  kinds: [
    { kind: 'audio', contentTypes: ['audio/*'] },
    { kind: 'video', contentTypes: ['video/*'] },
    { kind: 'image', contentTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/bmp'] },
  ],
} satisfies ObjectAppPlugin
