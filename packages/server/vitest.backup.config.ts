import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node', include: ['tests/backup.smoke.ts'],
    fileParallelism: false, testTimeout: 15 * 60 * 1000, hookTimeout: 120_000,
  },
})
