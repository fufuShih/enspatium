import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
})
