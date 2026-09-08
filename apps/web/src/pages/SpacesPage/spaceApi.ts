import type { QueryClient } from '@tanstack/react-query'
import type { CreateSpace201, ListNamespaces200Item, ListSpaces200Item } from '../../api/generated/api.schemas.ts'
import { getGetSpaceQueryKey, getListSpacesQueryKey } from '../../api/generated/spaces.ts'
import { apiStatus } from '../../context/session.ts'

export function spacePath(account: string, slug: string) {
  return `/${encodeURIComponent(account)}/${encodeURIComponent(slug)}`
}

export function makeSpaceSlug(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/^-+|-+$/g, '')
}

export function creatableNamespaces(namespaces: ListNamespaces200Item[], userId: string) {
  return namespaces.filter(namespace => namespace.ownerUserId === userId)
}

export function spaceErrorMessage(error: unknown) {
  switch (apiStatus(error)) {
    case 400: return 'Check the name and URL. Use 3–40 lowercase letters, numbers, or single hyphens for the URL.'
    case 401: return 'Please sign in to continue.'
    case 403: return 'You do not have permission to access this Space or account.'
    case 404: return 'This Space or account could not be found.'
    case 409: return 'This URL is already used in this account. Choose another one.'
    default: return 'Unable to connect. Please try again.'
  }
}

export async function cacheCreatedSpace(client: QueryClient, account: string, userId: string, space: CreateSpace201) {
  const listKey = getListSpacesQueryKey(account)
  await client.cancelQueries({ queryKey: listKey })
  client.setQueryData<ListSpaces200Item[]>([...listKey, userId], current =>
    current ? [...current.filter(item => item.id !== space.id), space] : undefined,
  )
  await client.invalidateQueries({ queryKey: listKey, refetchType: 'none' })
  client.setQueryData([...getGetSpaceQueryKey(account, space.slug), userId], space)
}

export async function clearDeletedSpace(client: QueryClient, account: string, slug: string) {
  const endpoint = getGetSpaceQueryKey(account, slug)[0]
  const filters = { predicate: (query: { queryKey: readonly unknown[] }) => typeof query.queryKey[0] === 'string' && (query.queryKey[0] === endpoint || query.queryKey[0].startsWith(endpoint + '/')) }
  await client.cancelQueries(filters)
  client.removeQueries(filters)
  await client.invalidateQueries({ queryKey: getListSpacesQueryKey(account), refetchType: 'none' })
}
