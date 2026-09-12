import react from '@vitejs/plugin-react'
import { defineConfig, normalizePath } from 'vite'
import { resolve } from 'node:path'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), viteStaticCopy({
    targets: ['cmaps', 'standard_fonts', 'wasm', 'iccs'].map(folder => ({
      src: normalizePath(resolve(import.meta.dirname, `node_modules/pdfjs-dist/${folder}/*`)),
      dest: `pdfjs/${folder}`,
      rename: { stripBase: true },
    })),
  })],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        rewrite: path => path.replace(/^\/api/, ''),
      },
    },
  },
})
