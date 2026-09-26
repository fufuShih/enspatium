import type { QueryClient } from '@tanstack/react-query'
import type { GetSpace200, ListApps200Item } from '../../../api/generated/api.schemas'
import { apiStatus } from '../../../context/session'
import { getAppPlugin } from '../../AppPages/registry'
import { refreshSpaceSettings } from '../settings/settingsApi'
import { getGetAppPwaEntryQueryKey } from '../../../api/generated/apps'

export function compatibleSpaceApps(apps: ListApps200Item[], storageType: GetSpace200['type']) {
  return apps.filter(app => app.storageType === storageType && getAppPlugin(app.type)?.integration.storageType === storageType)
}

export function spaceAppError(error: unknown) {
  switch (apiStatus(error)) {
    case 400: return 'Choose a compatible app and enter a name of 1–100 characters.'
    case 401: return 'Please sign in again to manage apps.'
    case 403: return 'Only a Space owner can manage apps. Custom app types also require their creator.'
    case 404: return 'This app or Space no longer exists. Refresh the list.'
    default: return 'Unable to update apps. Refresh the list before trying again.'
  }
}

export async function refreshSpaceApps(client: QueryClient, account: string, slug: string, instance?: { id: string; appType: string }) {
  // Includes the Apps list, Space compatibility field, cards and audit queries.
  await refreshSpaceSettings(client, account, slug)
  if (instance) {
    const queryKey = ['app-instance', instance.appType, instance.id]
    await client.cancelQueries({ queryKey })
    await client.invalidateQueries({ queryKey })
    await client.invalidateQueries({ queryKey: getGetAppPwaEntryQueryKey(instance.appType, instance.id) })
  }
}
