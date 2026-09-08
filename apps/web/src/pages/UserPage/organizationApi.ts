import type { QueryClient } from '@tanstack/react-query'
import { getGetNamespaceQueryKey, getListNamespacesQueryKey } from '../../api/generated/namespaces.ts'
import { apiStatus } from '../../context/session.ts'

export function organizationErrorMessage(error: unknown) {
  switch (apiStatus(error)) {
    case 400: return 'Check the name and URL. Use 3–40 lowercase letters, numbers, or single hyphens, and avoid reserved names such as settings or login.'
    case 401: return 'Please sign in to create an organization.'
    case 409: return 'This URL is already in use. Choose another one.'
    default: return 'Unable to create the organization. Please try again.'
  }
}

export function memberErrorMessage(error: unknown, organization: boolean, adding = false) {
  switch (apiStatus(error)) {
    case 400: return 'Check the email address and selected role.'
    case 401: return 'Please sign in again to manage members.'
    case 403: return 'Only an owner can manage members.'
    case 404: return adding ? organization ? 'No registered user has this email address.' : 'Add this user to the organization first, then add them to this Space.' : 'This member or account no longer exists. Refresh and try again.'
    case 409: return adding ? 'This user is already a member.' : 'The owner cannot be changed or removed.'
    default: return 'Unable to update members. Please try again.'
  }
}

export async function refreshOrganization(client: QueryClient, account: string) {
  const endpoint = getGetNamespaceQueryKey(account)[0]
  const filters = { predicate: (query: { queryKey: readonly unknown[] }) => typeof query.queryKey[0] === 'string' && (query.queryKey[0] === endpoint || query.queryKey[0].startsWith(endpoint + '/')) }
  await client.cancelQueries(filters)
  await Promise.all([
    client.invalidateQueries(filters),
    client.invalidateQueries({ queryKey: getListNamespacesQueryKey() }),
  ])
}
