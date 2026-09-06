import type { GetGitSpaceInfo200, GetGitSpaceTree200EntriesItem } from '../../api/generated/api.schemas.ts'
import { apiStatus } from '../../context/session.ts'
import { spacePath } from './spaceApi.ts'

export function defaultGitBranch(info: GetGitSpaceInfo200) {
  return info.branches.includes(info.defaultBranch) ? info.defaultBranch : info.branches[0] ?? ''
}

export function gitLocation(account: string, slug: string, branch: string, path = '', file = false) {
  const query = new URLSearchParams()
  if (branch) query.set('ref', branch)
  if (path) query.set('path', path)
  if (file) query.set('view', 'file')
  return `${spacePath(account, slug)}${query.size ? `?${query}` : ''}`
}

export function sortGitEntries(entries: GetGitSpaceTree200EntriesItem[]) {
  return [...entries].sort((left, right) => Number(right.type === 'directory') - Number(left.type === 'directory') || left.name.localeCompare(right.name, 'en'))
}

export function gitErrorMessage(error: unknown) {
  switch (apiStatus(error)) {
    case 400: return 'This path or branch cannot be opened.'
    case 401: return 'Please sign in to view this repository.'
    case 403: return 'You do not have access to this repository.'
    case 404: return 'This branch or path no longer exists.'
    case 413: return 'This file is too large to preview. Text previews are limited to 1 MiB.'
    default: return 'Unable to load repository content. Please try again.'
  }
}
