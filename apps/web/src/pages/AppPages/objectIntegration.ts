import { getAppInstance } from '../../api/generated/apps'
import { getDownloadAppInstanceContentUrl, getGetAppInstanceObjectQueryKey, getListAppInstanceObjectsQueryKey, headAppInstanceContent, useGetAppInstanceObject, useListAppInstanceObjects } from '../../api/generated/app-objects'
import type { GetAppInstanceObject200, ListAppInstanceObjects200 } from '../../api/generated/api.schemas'
import type { AppInstance } from './types'

// Every read targets the instance; only ordinary Object mutations use its resolved Space.
export function createObjectAppIntegration(appType: string) {
  return {
    storageType: 'object' as const,
    loadInstance: (appId: string, signal: AbortSignal) => getAppInstance(appType, appId, { signal }),
    useList: (instance: AppInstance, params?: Parameters<typeof useListAppInstanceObjects>[2], options?: Parameters<typeof useListAppInstanceObjects<ListAppInstanceObjects200>>[3]) => useListAppInstanceObjects(appType, instance.id, params, {
      ...options, query: { ...options?.query, meta: { ...options?.query?.meta, appObjectSpace: `${instance.account}/${instance.slug}` } },
    }),
    listQueryKey: (appId: string, params?: Parameters<typeof getListAppInstanceObjectsQueryKey>[2]) => getListAppInstanceObjectsQueryKey(appType, appId, params),
    useItem: (appId: string, itemId: string, options?: Parameters<typeof useGetAppInstanceObject<GetAppInstanceObject200>>[3]) => useGetAppInstanceObject(appType, appId, itemId, options),
    itemQueryKey: (appId: string, itemId: string) => getGetAppInstanceObjectQueryKey(appType, appId, itemId),
    contentUrl: (appId: string, params: Parameters<typeof getDownloadAppInstanceContentUrl>[2]) => getDownloadAppInstanceContentUrl(appType, appId, params),
    headContent: (appId: string, params: Parameters<typeof headAppInstanceContent>[2], options?: RequestInit) => headAppInstanceContent(appType, appId, params, options),
  }
}
