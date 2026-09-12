import { getAppSpace } from '../../api/generated/apps'
import { getDownloadAppContentUrl, getGetAppObjectQueryKey, getListAppObjectsQueryKey, headAppContent, useGetAppObject, useListAppObjects } from '../../api/generated/app-objects'
import type { GetAppObject200, ListAppObjects200 } from '../../api/generated/api.schemas'

// Bind the generic Object App API once; each plugin only supplies its registered type.
export function createObjectAppIntegration(appType: string) {
  return {
    storageType: 'object' as const,
    loadSpace: (spaceId: string, signal: AbortSignal) => getAppSpace(appType, spaceId, { signal }),
    useList: (account: string, slug: string, params?: Parameters<typeof useListAppObjects>[3], options?: Parameters<typeof useListAppObjects<ListAppObjects200>>[4]) => useListAppObjects(account, slug, appType, params, options),
    listQueryKey: (account: string, slug: string, params?: Parameters<typeof getListAppObjectsQueryKey>[3]) => getListAppObjectsQueryKey(account, slug, appType, params),
    useItem: (account: string, slug: string, itemId: string, options?: Parameters<typeof useGetAppObject<GetAppObject200>>[4]) => useGetAppObject(account, slug, appType, itemId, options),
    itemQueryKey: (account: string, slug: string, itemId: string) => getGetAppObjectQueryKey(account, slug, appType, itemId),
    contentUrl: (account: string, slug: string, params: Parameters<typeof getDownloadAppContentUrl>[3]) => getDownloadAppContentUrl(account, slug, appType, params),
    headContent: (account: string, slug: string, params: Parameters<typeof headAppContent>[3], options?: RequestInit) => headAppContent(account, slug, appType, params, options),
  }
}
