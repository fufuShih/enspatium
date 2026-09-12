import { defineConfig } from 'vitest/config'

export default defineConfig({ test: {
  environment: 'node', include: ['tests/upgrade.smoke.ts'], fileParallelism: false,
  testTimeout: 600_000, hookTimeout: 120_000,
} })
