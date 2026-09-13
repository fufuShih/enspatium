const encode = encodeURIComponent
const filePath = (value: string) => value.split('/').map(encode).join('/')
const identityKeys = ['ref', 'refType', 'path', 'view', 'commit', 'snapshot', 'from', 'to', 'base', 'head', 'file']

// View state uses the same parameter names as API-facing helpers, but lives in URL paths.
export function gitRouteLocation(account: string, slug: string, params: URLSearchParams) {
  const root = `/${encode(account)}/${encode(slug)}`
  const type = params.get('refType') === 'tag' ? 'tag' : 'branch'
  const ref = params.get('ref') || ''
  const view = params.get('view')
  const commit = params.get('commit')
  const snapshot = params.get('snapshot')
  let route = root
  if (view === 'compare') {
    route += '/compare'
    if (params.get('from') || params.get('to')) route += `/${encode(params.get('from') || '-')}/${encode(params.get('to') || '-')}`
    if (params.get('base') && params.get('head')) route += `/at/${encode(params.get('base')!)}/${encode(params.get('head')!)}`
    if (params.get('file')) route += `/file/${filePath(params.get('file')!)}`
  } else if (view === 'commits' && commit) {
    route += `/commit/${encode(commit)}`
    if (params.get('file')) route += `/file/${filePath(params.get('file')!)}`
  } else {
    if (ref) route += `/${type}/${encode(ref)}`
    else if (type === 'tag') route += '/tag'
    if (view === 'commits') {
      route += '/commits'
      if (snapshot) route += `/at/${encode(snapshot)}`
    } else {
      if (view === 'file' && commit) route += `/at/${encode(commit)}`
      if (view === 'file') route += `/file/${filePath(params.get('path') || '')}`
      else if (params.get('path')) route += `/tree/${filePath(params.get('path')!)}`
    }
  }
  const filters = new URLSearchParams()
  if (view === 'commits' && !commit && params.get('offset')) filters.set('offset', params.get('offset')!)
  return route + (filters.size ? `?${filters}` : '')
}

export function parseGitRoute(pathname: string, search = '') {
  // Read the raw pathname, not React Router's already-decoded params: %2F belongs
  // to a ref name, while a literal slash separates route and file path segments.
  const raw = pathname.split('/').slice(3)
  if (raw.at(-1) === '') raw.pop()
  const query = new URLSearchParams(search)
  if (!raw.length) return { params: query, valid: true, legacy: identityKeys.some(key => query.has(key)) }
  const params = new URLSearchParams()
  let parts: string[]
  try { parts = raw.map(decodeURIComponent) } catch { return { params, valid: false, legacy: false } }
  const read = () => parts.shift()
  const rest = (key: string) => { if (!parts.length || parts.some(part => !part)) return false; params.set(key, parts.join('/')); parts = []; return true }
  let valid = true
  const first = read()
  if (first === 'branches' || first === 'tags') {
    // Old list URLs now open the file browser instead of a separate page.
    params.set('refType', first === 'tags' ? 'tag' : 'branch')
    return { params, valid: !parts.length, legacy: true }
  } else if (first === 'commit') {
    params.set('view', 'commits')
    const id = read()
    if (!id) valid = false
    else params.set('commit', id)
    if (parts.length) valid = read() === 'file' && rest('file')
  } else if (first === 'compare') {
    params.set('view', 'compare')
    if (parts.length) {
      const from = read(), to = read()
      if (!from || !to) valid = false
      else { if (from !== '-') params.set('from', from); if (to !== '-') params.set('to', to) }
    }
    if (parts[0] === 'at') {
      read(); const base = read(), head = read()
      if (!base || !head) valid = false
      else { params.set('base', base); params.set('head', head) }
    }
    if (parts.length) valid = valid && read() === 'file' && rest('file')
  } else {
    if (first === 'branch' || first === 'tag') {
      params.set('refType', first)
      const ref = read()
      if (ref) params.set('ref', ref)
      else if (first !== 'tag') valid = false
    } else if (first) parts.unshift(first)
    const mode = read()
    if (mode === 'commits') {
      params.set('view', 'commits')
      if (parts.length) {
        const at = read(), id = read()
        if (at !== 'at' || !id) valid = false
        else params.set('snapshot', id)
      }
    } else {
      let resource = mode
      if (resource === 'at') {
        const id = read()
        if (!id) valid = false
        else params.set('commit', id)
        resource = read()
        if (resource !== 'file') valid = false
      }
      if (resource === 'file' || resource === 'tree') {
        if (resource === 'file') params.set('view', 'file')
        valid = valid && rest('path')
      } else if (resource) valid = false
    }
  }
  valid = valid && !parts.length
  // Only list controls are taken from search; query strings cannot override path identity.
  if (params.get('view') === 'commits' && query.has('offset')) params.set('offset', query.get('offset')!)
  return { params, valid, legacy: false }
}
