import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/deployment.smoke.ts'],
    fileParallelism: false,
    testTimeout: 180_000,
  },
})
