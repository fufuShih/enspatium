// Encode each appended segment separately so object names cannot change the URL structure.
export function appPath(type: string, spaceId: string, ...segments: string[]) {
  return '/app/' + [type, spaceId, ...segments].map(segment => encodeURIComponent(segment)).join('/')
}
