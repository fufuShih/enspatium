import type { ObjectAppPlugin } from '../types.js'

export const ebookPlugin = {
  type: 'ebook', storageType: 'object',
  kinds: [
    { kind: 'epub', contentTypes: ['application/epub+zip'], extensions: ['epub'], contentType: 'application/epub+zip' },
    { kind: 'pdf', contentTypes: ['application/pdf'], extensions: ['pdf'], contentType: 'application/pdf' },
  ],
} satisfies ObjectAppPlugin
