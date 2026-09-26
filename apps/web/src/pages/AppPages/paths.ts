// Encode each appended segment separately so object names cannot change the URL structure.
export function appPath(type: string, appId: string, ...segments: string[]) {
  return '/app/' + [type, appId, ...segments].map(segment => encodeURIComponent(segment)).join('/') + (segments.length ? '' : '/')
}
