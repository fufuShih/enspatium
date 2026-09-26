import type { GetAppPwaEntry200 } from '../../api/generated/api.schemas'
import { appPath } from './paths'

export function clearPwaMetadata() {
  document.querySelectorAll('[data-enspatium-pwa]').forEach(element => element.remove())
}

export function setPwaMetadata(entry: GetAppPwaEntry200, dark: boolean) {
  clearPwaMetadata()
  if (!entry.enabled) return
  const base = appPath(entry.appType, entry.id)
  for (const [tag, attributes] of [
    ['link', { rel: 'manifest', href: base + 'manifest.webmanifest' }],
    ['link', { rel: 'apple-touch-icon', href: base + 'icon-192.png?v=' + encodeURIComponent(entry.version ?? '') }],
    ['meta', { name: 'application-name', content: entry.name ?? '' }],
    ['meta', { name: 'theme-color', content: entry.themeColor ?? (dark ? '#0b0f0d' : '#eef2f0') }],
  ] as const) {
    const element = document.createElement(tag)
    element.setAttribute('data-enspatium-pwa', '')
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value)
    document.head.append(element)
  }
}

export async function unregisterAppWorker(container: ServiceWorkerContainer, origin: string, base: string) {
  const scope = new URL(base, origin).href
  for (const registration of await container.getRegistrations()) {
    // Never remove another App's registration or one scoped to the main site.
    if (registration.scope === scope) await registration.unregister()
  }
}

export function registerAppWorker(container: ServiceWorkerContainer, base: string) {
  return container.register(base + 'sw.js', { scope: base, updateViaCache: 'none' })
}
