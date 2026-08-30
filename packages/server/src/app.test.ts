import { describe, expect, it, vi } from 'vitest'

import { buildApp } from './app.js'

describe('server', () => {
  it('reports its health', async () => {
    vi.stubEnv(
      'DATABASE_URL',
      'postgres://enspatium:enspatium@127.0.0.1:5432/enspatium',
    )

    const app = await buildApp()

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ status: 'ok' })
    } finally {
      await app.close()
      vi.unstubAllEnvs()
    }
  })
})
