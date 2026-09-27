export const objectFolderMarkerName = '.enspatium-folder'
export const objectFolderContentType = 'application/vnd.enspatium.folder'

export function isObjectFolderMarker(key: string, contentType: string) {
  return key.split('/').at(-1) === objectFolderMarkerName
    && contentType.split(';', 1)[0]!.trim().toLowerCase() === objectFolderContentType
}
