import { unpackEpub } from './archive'

self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  try {
    const files = unpackEpub(new Uint8Array(event.data))
    self.postMessage({ files })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Cannot open this EPUB.' })
  }
}
