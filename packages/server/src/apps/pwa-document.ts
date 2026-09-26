// Shared by production HTML delivery and the Vite development middleware.
// This public shape must never contain Space slugs, users, Object IDs or config.
export interface PublicPwaEntry {
  id: string
  appType: string
  enabled: boolean
  name?: string
  themeColor?: string | null
  version?: string
}

export function pwaBasePath(appType: string, appId: string) {
  return `/app/${encodeURIComponent(appType)}/${encodeURIComponent(appId)}/`
}

export function parseAppEntryPath(path: string) {
  // Canonical lowercase types/UUIDs avoid multiple scopes for the same App.
  const match = /^\/app\/([a-z0-9]+(?:-[a-z0-9]+)*)\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(\/.*)?$/.exec(path)
  if (!match || match[1]!.length < 3 || match[1]!.length > 60) return null
  return { appType: match[1]!, appId: match[2]!, child: match[3]?.slice(1) ?? '' }
}

export function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

export function pwaManifest(entry: PublicPwaEntry) {
  const base = pwaBasePath(entry.appType, entry.id)
  return { id: `/app-id/${entry.id}`, name: entry.name, start_url: base, scope: base, display: 'standalone',
    theme_color: entry.themeColor ?? '#eef2f0', background_color: '#eef2f0',
    icons: [192, 512].map(size => ({ src: `${base}icon-${size}.png?v=${encodeURIComponent(entry.version ?? '')}`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' })) }
}

export function renderAppDocument(template: string, entry: PublicPwaEntry | null) {
  const base = entry ? pwaBasePath(entry.appType, entry.id) : ''
  const tags = entry?.enabled ? `<link data-enspatium-pwa rel="manifest" href="${base}manifest.webmanifest">
    <link data-enspatium-pwa rel="apple-touch-icon" href="${base}icon-192.png?v=${encodeURIComponent(entry.version ?? '')}">
    <meta data-enspatium-pwa name="application-name" content="${escapeHtml(entry.name ?? '')}">
    ${entry.themeColor ? `<meta data-enspatium-pwa name="theme-color" content="${escapeHtml(entry.themeColor)}">` : '<meta data-enspatium-pwa name="theme-color" content="#eef2f0" media="(prefers-color-scheme: light)"><meta data-enspatium-pwa name="theme-color" content="#0b0f0d" media="(prefers-color-scheme: dark)">'}` : ''
  return template.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(entry?.enabled ? entry.name ?? 'Enspatium' : 'Enspatium')}</title>`)
    .replace('</head>', () => tags + '\n  </head>')
}
