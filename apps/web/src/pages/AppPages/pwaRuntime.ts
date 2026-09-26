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

export async function clearAppCaches(storage: CacheStorage, appId: string) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(appId)) return
  const prefix = `enspatium-pwa:${appId}:`
  await Promise.all((await storage.keys()).filter(key => key.startsWith(prefix)).map(key => storage.delete(key)))
}

export function appWorkerStatus(worker: ServiceWorker, prepare = false): Promise<{ ready: boolean; development?: boolean }> {
  return new Promise(resolve => {
    const channel = new MessageChannel()
    const finish = (status: { ready: boolean; development?: boolean }) => { clearTimeout(timeout); channel.port1.close(); channel.port2.close(); resolve(status) }
    const timeout = setTimeout(() => finish({ ready: false }), prepare ? 12_000 : 3000)
    channel.port1.onmessage = event => finish({ ready: event.data?.ready === true, development: event.data?.development === true })
    try { worker.postMessage(prepare ? 'PWA_PREPARE' : 'PWA_STATUS', [channel.port2]) } catch { finish({ ready: false }) }
  })
}

export function registerAppWorker(container: ServiceWorkerContainer, base: string) {
  return container.register(base + 'sw.js', { scope: base, updateViaCache: 'none' })
}
