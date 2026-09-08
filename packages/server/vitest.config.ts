import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Git subprocesses and password hashing need headroom on busy development machines.
    testTimeout: 15_000,
  },
})
