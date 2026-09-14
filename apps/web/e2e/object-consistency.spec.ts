import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures.js'
import { createSpace, register, signIn } from './helpers.js'

async function upload(page: Page, content: string) {
  await expect(page.getByLabel('Choose a file to upload', { exact: true })).toBeEnabled()
  await page.getByLabel('Choose a file to upload', { exact: true }).setInputFiles({
    name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from(content),
  })
  await expect(page.getByRole('status').filter({ hasText: 'Uploaded notes.txt.' })).toBeVisible()
}

test('an open preview and download keep their version while stale deletion preserves newer content', async ({ page }) => {
  await signIn(page, await register(page, 'Snapshot owner'))
  const space = await createSpace(page, 'Snapshot files', undefined, 'object')
  const base = `/api/namespaces/${space.account}/spaces/${space.slug}`
  const contentUrl = base + '/objects/notes.txt'
  await upload(page, 'Original content')
  await page.getByRole('button', { name: 'Open notes.txt', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('File contents', { exact: true })).toHaveText('Original content')
  // Another client overwrites the file without changing the open preview.
  expect((await page.request.put(contentUrl, { data: 'Newer content', headers: { 'content-type': 'text/plain' } })).status()).toBe(201)
  await expect(dialog.getByLabel('File contents', { exact: true })).toHaveText('Original content')
  const downloading = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download', exact: true }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe('notes.txt')
  expect(await readFile((await download.path())!, 'utf8')).toBe('Original content')
  await dialog.getByRole('button', { name: 'Delete file', exact: true }).click()
  await dialog.getByRole('button', { name: 'Confirm delete', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('This file has changed')
  expect(await (await page.request.get(contentUrl)).text()).toBe('Newer content')
  const history = await (await page.request.get(base + '/object-versions?key=notes.txt')).json()
  expect(history.object).toMatchObject({ revision: 2, isDeleted: false })
  expect(history.versions).toHaveLength(2)
  await dialog.getByRole('button', { name: 'Close preview', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: 'Open notes.txt', exact: true }).click()
  await expect(dialog.getByLabel('File contents', { exact: true })).toHaveText('Newer content')
})

test('restore confirmation keeps its original precondition across a background refresh and requires review after conflict', async ({ page }) => {
  await signIn(page, await register(page, 'Restore owner'))
  const space = await createSpace(page, 'Restore conflicts', undefined, 'object')
  const base = `/api/namespaces/${space.account}/spaces/${space.slug}`
  const contentUrl = base + '/objects/notes.txt'
  await upload(page, 'First content')
  await upload(page, 'Second content')
  await page.getByRole('button', { name: 'Open notes.txt', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('File contents', { exact: true })).toHaveText('Second content')
  await dialog.getByRole('button', { name: 'Versions', exact: true }).click()
  await dialog.getByRole('button', { name: 'Restore version 1', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Confirm restore', exact: true })).toBeVisible()
  expect((await page.request.put(contentUrl, { data: 'Concurrent content', headers: { 'content-type': 'text/plain' } })).status()).toBe(201)

  // Returning to a visible tab refetches history while confirmation stays open.
  const refreshed = page.waitForResponse(response => response.request().method() === 'GET' && response.url().includes('/object-versions?') && response.status() === 200)
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
  await refreshed
  await expect(dialog.getByLabel('Version history').getByText('Version 3 · Current', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Confirm restore', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('This file has changed')
  await expect(dialog.getByRole('button', { name: 'Confirm restore', exact: true })).toHaveCount(0)
  expect(await (await page.request.get(contentUrl)).text()).toBe('Concurrent content')
  const unchanged = await (await page.request.get(base + '/object-versions?key=notes.txt')).json()
  expect(unchanged.object.revision).toBe(3)
  expect(unchanged.versions).toHaveLength(3)

  // Review the latest version before making a new restore decision.
  await dialog.getByRole('button', { name: 'Preview version 3', exact: true }).click()
  await expect(dialog.getByLabel('File contents', { exact: true })).toHaveText('Concurrent content')
  await dialog.getByRole('button', { name: 'Restore version 1', exact: true }).click()
  await dialog.getByRole('button', { name: 'Confirm restore', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: 'Open notes.txt', exact: true }).click()
  await expect(dialog.getByLabel('File contents', { exact: true })).toHaveText('First content')
  const restored = await (await page.request.get(base + '/object-versions?key=notes.txt')).json()
  expect(restored.object).toMatchObject({ revision: 4, isDeleted: false })
  const concurrent = restored.versions.find((version: { revision: number }) => version.revision === 3)
  expect(concurrent).toBeDefined()
  const historical = await page.request.get(base + '/object-versions/content?' + new URLSearchParams({ key: 'notes.txt', versionId: concurrent.versionId }))
  expect(historical.status()).toBe(200)
  expect(await historical.text()).toBe('Concurrent content')
})
