export type ObjectAppKind = {
  kind: string
  contentTypes: readonly string[]
  // Extension fallback applies only to application/octet-stream uploads.
  extensions?: readonly string[]
  // Optional MIME types eligible for extension fallback (e.g. Markdown uploaded as plain text).
  extensionContentTypes?: readonly string[]
  contentType?: string
}

export type ObjectAppPlugin = {
  type: string
  storageType: 'object'
  kinds: readonly ObjectAppKind[]
}
