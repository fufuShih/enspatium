import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node', include: ['tests/jobs.smoke.ts'],
    fileParallelism: false, testTimeout: 20 * 60 * 1000, hookTimeout: 120_000,
  },
})
