import react from '@vitejs/plugin-react'
import { defineConfig, normalizePath } from 'vite'
import { resolve } from 'node:path'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { appEntryPlugin } from './scripts/app-entry-plugin.js'
import { pwaShellPlugin } from './scripts/pwa-shell-plugin.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [appEntryPlugin(), pwaShellPlugin(), react(), viteStaticCopy({
    targets: ['cmaps', 'standard_fonts', 'wasm', 'iccs'].map(folder => ({
      src: normalizePath(resolve(import.meta.dirname, `node_modules/pdfjs-dist/${folder}/*`)),
      dest: `pdfjs/${folder}`,
      rename: { stripBase: true },
    })),
  })],
  build: { manifest: true, rolldownOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), offline: resolve(import.meta.dirname, 'offline.html') } } },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        rewrite: path => path.replace(/^\/api/, ''),
      },
    },
  },
})
