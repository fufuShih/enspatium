import { parseAppEntryPath, pwaBasePath } from './pwa-document.js'

export interface PwaShell {
  build: string
  html: string
  assets: { url: string; sha256: string; type: 'text/css' | 'javascript' }[]
}

export function validatePwaShell(value: unknown): PwaShell {
  const shell = value as PwaShell | null
  const hash = (text: unknown) => typeof text === 'string' && /^[0-9a-f]{64}$/.test(text)
  if (!shell || !hash(shell.build) || !hash(shell.html) || !Array.isArray(shell.assets) || !shell.assets.length || shell.assets.length > 32
    || shell.assets.some(asset => !asset || !/^\/assets\/[\w-]+-[\w-]+\.(?:js|css)$/.test(asset.url) || !hash(asset.sha256)
      || asset.type !== (asset.url.endsWith('.css') ? 'text/css' : 'javascript'))
    || new Set(shell.assets.map(asset => asset.url)).size !== shell.assets.length) throw new Error('Invalid PWA shell build')
  return shell
}

// Cache Storage is origin-wide, so every cleanup must use this exact App prefix.
export function pwaCachePrefix(appId: string) { return `enspatium-pwa:${appId}:` }

export function pwaWorker(appType: string, appId: string, shell: PwaShell | null) {
  const base = pwaBasePath(appType, appId)
  if (!parseAppEntryPath(base)) throw new Error('Invalid App worker scope')
  if (shell) validatePwaShell(shell)
  const prefix = pwaCachePrefix(appId)
  if (!shell) return `// Enspatium PWA cleanup v2
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  await Promise.all((await caches.keys()).filter(key => key.startsWith(${JSON.stringify(prefix)})).map(key => caches.delete(key)));
  await self.registration.unregister();
})()));
`
  return `// Enspatium PWA shell v2. No private HTML, API or content caching.
const base = ${JSON.stringify(base)};
const prefix = ${JSON.stringify(prefix)};
const build = ${JSON.stringify(shell.build)};
const cacheName = prefix + build;
const offline = base + 'offline.html?build=' + build;
const assets = ${JSON.stringify(shell.assets)};
const resources = [{ url: offline, sha256: ${JSON.stringify(shell.html)}, type: 'text/html' }, ...assets];
const assetUrls = new Set(assets.map(asset => new URL(asset.url, self.location.origin).href));
const ready = async () => (await Promise.all(resources.map(resource => caches.match(resource.url, { cacheName })))).every(Boolean);
let preparing;
function prepare() {
  if (preparing) return preparing;
  preparing = prepareShell().finally(() => { preparing = undefined; });
  return preparing;
}
async function prepareShell() {
  // Verify all bytes before writing. A mismatched deployment or redirect must
  // not poison an existing cache or activate a partially installed worker.
  const responses = await Promise.all(resources.map(async resource => {
    const response = await fetch(resource.url, { credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok || response.status !== 200 || !response.headers.get('content-type')?.includes(resource.type)) throw new Error('Offline resource unavailable');
    const bytes = await response.clone().arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== resource.sha256) throw new Error('Offline build mismatch');
    return response;
  }));
  const cache = await caches.open(cacheName);
  try { await Promise.all(resources.map((resource, index) => cache.put(resource.url, responses[index]))); }
  catch (error) { await caches.delete(cacheName); throw error; }
}
self.addEventListener('install', event => event.waitUntil(prepare().then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil((async () => {
  await Promise.all((await caches.keys()).filter(key => key.startsWith(prefix) && key !== cacheName).map(key => caches.delete(key)));
  await self.clients.claim();
})()));
self.addEventListener('message', event => {
  if (event.data === 'PWA_STATUS' || event.data === 'PWA_PREPARE') event.waitUntil((async () => {
    // Storage eviction need not remove the registration. Repair only the same
    // immutable shell; failures keep online use and other App caches untouched.
    if (event.data === 'PWA_PREPARE' && !await ready()) await prepare().catch(() => {});
    event.ports[0]?.postMessage({ ready: await ready(), build });
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('range') || request.headers.has('authorization')) return;
  if (assetUrls.has(url.href)) {
    event.respondWith((async () => (await caches.match(request, { cacheName })) || fetch(request))());
  } else if (request.mode === 'navigate' && url.pathname.startsWith(base) && !/\\.[^/]+$/.test(url.pathname)) {
    // Never replace HTTP errors (including revoked access/deleted Apps). Only
    // failed network navigations get the generic, non-personalized offline page.
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(async () =>
      (await caches.match(offline, { cacheName })) || Response.error()));
  }
});
`
}
