import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Manifest, Plugin } from 'vite'
import type { PwaShell } from '../../../packages/server/src/apps/pwa-worker.js'

const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')

// Only the dedicated, data-free offline entry and its static dependency graph
// are eligible. The main application, public/ files and lazy views are excluded.
export function pwaShellPlugin(): Plugin {
  let output: string
  return { name: 'enspatium-pwa-shell', apply: 'build', enforce: 'post',
    configResolved(config) { output = resolve(config.root, config.build.outDir) },
    async writeBundle() {
      const manifest = JSON.parse(await readFile(resolve(output, '.vite/manifest.json'), 'utf8')) as Manifest
      const files = new Set<string>()
      const visited = new Set<string>()
      function visit(key: string) {
        if (visited.has(key)) return
        visited.add(key)
        const entry = manifest[key]
        if (!entry) throw new Error('Offline entry dependency missing: ' + key)
        files.add(entry.file)
        entry.css?.forEach(file => files.add(file))
        entry.imports?.forEach(visit)
        if (entry.dynamicImports?.length || entry.assets?.length) throw new Error('Offline entry must use only static JS and CSS')
      }
      visit('offline.html')
      const assets: PwaShell['assets'] = []
      for (const file of [...files].sort()) {
        if (!/^assets\/[\w-]+-[\w-]+\.(?:js|css)$/.test(file)) throw new Error('Unsafe offline asset: ' + file)
        assets.push({ url: '/' + file, sha256: digest(await readFile(resolve(output, file))), type: file.endsWith('.css') ? 'text/css' : 'javascript' })
      }
      const html = digest(await readFile(resolve(output, 'offline.html')))
      // Main app changes also produce a new cache generation, without caching it.
      const build = digest(JSON.stringify({ manifest, html, assets }))
      const shell: PwaShell = { build, html, assets }
      await writeFile(resolve(output, 'pwa-shell.json'), JSON.stringify(shell))
    },
  }
}
