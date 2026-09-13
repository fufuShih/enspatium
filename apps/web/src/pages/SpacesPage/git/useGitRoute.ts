import { useLocation } from 'react-router'
import { parseGitRoute } from './gitRoutes'

export function useGitRoute() {
  const location = useLocation()
  const route = parseGitRoute(location.pathname, location.search)
  // Commits have independent URLs. Browser history may remember the branch/tag
  // used to reach one, without putting that optional context into its identity.
  const context = location.state?.gitRef
  if (route.params.get('view') === 'commits' && route.params.has('commit') && context && typeof context.name === 'string' && ['branch', 'tag'].includes(context.type)) {
    route.params.set('ref', context.name)
    route.params.set('refType', context.type)
  }
  return route
}
