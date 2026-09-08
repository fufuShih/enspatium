import type { QueryClient } from '@tanstack/react-query'
import { getGetSpaceQueryKey, getListSpacesQueryKey } from '../../api/generated/spaces.ts'
import { apiStatus } from '../../context/session.ts'
import { storageErrorMessage } from './storageErrors.ts'

export function settingsErrorMessage(error: unknown) {
  return storageErrorMessage(error) ?? ({
    400: 'Check your settings and try again.',
    401: 'Please sign in again to save changes.',
    403: 'Only a Space owner can manage settings.',
    404: 'This Space or branch no longer exists. Refresh and try again.',
  }[apiStatus(error) ?? 0] ?? 'Unable to save changes. Please try again.')
}

export async function refreshSpaceSettings(client: QueryClient, account: string, slug: string) {
  const endpoint = getGetSpaceQueryKey(account, slug)[0]
  const filters = { predicate: (query: { queryKey: readonly unknown[] }) => typeof query.queryKey[0] === 'string' && (query.queryKey[0] === endpoint || query.queryKey[0].startsWith(endpoint + '/')) }
  // Cancel reads started before the update so old visibility or branch data cannot win.
  await client.cancelQueries(filters)
  await Promise.all([
    client.invalidateQueries(filters),
    client.invalidateQueries({ queryKey: getListSpacesQueryKey(account) }),
  ])
}
