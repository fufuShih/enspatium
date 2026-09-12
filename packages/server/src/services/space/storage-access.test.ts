import { expect, test } from 'vitest'
import { resolve } from 'node:path'
import {
  acquireStorageWrite,
  withStorageCheck,
  withStorageWrite,
} from './storage-access.js'

test('all active writers must finish before checking; errors release the check', async () => {
  const root = resolve('storage-gate-test')
  const first = acquireStorageWrite(root)
  const second = acquireStorageWrite(root)
  await expect(withStorageCheck(root, async () => {})).rejects.toMatchObject({
    statusCode: 409,
  })
  first()
  await expect(withStorageCheck(root, async () => {})).rejects.toMatchObject({
    code: 'STORAGE_BUSY',
  })
  second()
  await expect(
    withStorageCheck(root, async () => {
      await expect(
        withStorageWrite(root, async () => {}),
      ).rejects.toMatchObject({ statusCode: 409 })
      await expect(
        withStorageCheck(root, async () => {}),
      ).rejects.toMatchObject({ statusCode: 409 })
      await expect(
        withStorageWrite(root + '-other', async () => 1),
      ).resolves.toBe(1)
      throw new Error('scan failed')
    }),
  ).rejects.toThrow('scan failed')
  await expect(
    withStorageWrite(root, async () => {
      throw new Error('write failed')
    }),
  ).rejects.toThrow('write failed')
  await expect(withStorageCheck(root, async () => 1)).resolves.toBe(1)
})
