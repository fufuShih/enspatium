import { getDownloadMediaUrl, getListMediaQueryKey, headMediaContent, useListMedia } from '../../../../api/generated/objects'
import { getAppSpace } from '../../../../api/generated/apps'

// Media's connection to the existing, authorized Space and Object APIs.
export const mediaIntegration = {
  storageType: 'object' as const,
  loadSpace: (spaceId: string, signal: AbortSignal) => getAppSpace('media', spaceId, { signal }),
  useList: useListMedia,
  listQueryKey: getListMediaQueryKey,
  contentUrl: getDownloadMediaUrl,
  headContent: headMediaContent,
}
