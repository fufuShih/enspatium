export type ObjectAppKind = {
  kind: string
  contentTypes: readonly string[]
  // Extension fallback applies only to application/octet-stream uploads.
  extensions?: readonly string[]
  contentType?: string
}

export type ObjectAppPlugin = {
  type: string
  storageType: 'object'
  kinds: readonly ObjectAppKind[]
}
