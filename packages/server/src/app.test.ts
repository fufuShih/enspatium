import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { buildApp } from './app.js'

describe('server', () => {
  it('reports its health', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'enspatium-app-'))

    vi.stubEnv(
      'DATABASE_URL',
      'postgres://enspatium:enspatium@127.0.0.1:5432/enspatium',
    )
    vi.stubEnv('DATA_ROOT', dataRoot)
    vi.stubEnv('SESSION_KEY', '0'.repeat(64))
    vi.stubEnv('SESSION_SECURE', 'false')

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
      await rm(dataRoot, { recursive: true, force: true })
      vi.unstubAllEnvs()
    }
  })
})
