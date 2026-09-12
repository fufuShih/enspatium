import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { acquireStorageWrite } from '../../../packages/server/src/services/space/storage-access.js'
import { test, expect } from './fixtures.js'
import { createSpace, register, signIn, signOut } from './helpers.js'

test('only admins see site administration and can inspect storage from the menu', async ({ page, environment }, testInfo) => {
  await page.goto('/settings/admin')
  await expect(page).toHaveURL(/\/login$/)
  const user = await register(page, 'Site owner')
  await signIn(page, user)
  const openMenu = () => page.getByRole('button', { name: 'User menu for ' + user.name, exact: true }).click()
  await openMenu()
  await expect(page.getByRole('menuitem', { name: 'Site administration', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.goto('/settings/admin')
  await expect(page.getByRole('heading', { name: 'Access denied', exact: true })).toBeVisible()
  expect((await page.request.post('/api/admin/storage/check', { data: {} })).status()).toBe(403)

  await environment.app.db.updateTable('users').set({ is_admin: true }).where('email', '=', user.email).execute()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Site administration', exact: true })).toBeVisible()
  const space = await createSpace(page, 'Integrity files', undefined, 'object')
  const base = `/api/namespaces/${space.account}/spaces/${space.slug}`
  const metadata = await (await page.request.get(base)).json()
  const upload = await page.request.put(base + '/objects/note.txt', { data: Buffer.from('hello'), headers: { 'content-type': 'text/plain' } })
  expect(upload.status()).toBe(201)
  const object = await upload.json()

  await openMenu()
  const items = await page.getByRole('menuitem').allTextContents()
  expect(items.at(-2)).toBe('Site administration')
  expect(items.at(-1)).toBe('Sign out')
  await page.screenshot({ path: testInfo.outputPath('admin-menu.png') })
  let checks = 0
  page.on('request', request => { if (request.url().endsWith('/api/admin/storage/check')) checks++ })
  await page.getByRole('menuitem', { name: 'Site administration', exact: true }).click()
  await expect(page).toHaveURL(/\/settings\/admin$/)
  await expect(page.getByRole('heading', { name: 'Storage integrity', exact: true })).toBeVisible()
  expect(checks).toBe(0)
  await page.getByLabel('Space ID (optional)', { exact: true }).fill(metadata.id)
  await page.getByLabel('Check type', { exact: true }).selectOption('deep')
  await page.getByRole('button', { name: 'Run check', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'No issues found' })).toBeVisible()
  expect(checks).toBe(1)
  await expect(page.getByLabel('Storage check results')).toContainText('1 Space · 1 file checked')
  await page.screenshot({ path: testInfo.outputPath('admin-page.png'), fullPage: true })

  const release = acquireStorageWrite(environment.app.config.DATA_ROOT)
  try {
    await page.getByRole('button', { name: 'Run check', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText('Storage is busy. Wait for the current operation to finish, then try again.')
    await expect(page.getByLabel('Storage check results')).toHaveCount(0)
  } finally { release() }

  const version = await environment.app.db.selectFrom('space_object_versions').select('storage_key').where('id', '=', object.versionId).executeTakeFirstOrThrow()
  // Only alter the isolated fixture's bytes to verify the report in the UI.
  await writeFile(join(environment.root, 'data', metadata.id, version.storage_key!), 'jello')
  await page.getByRole('button', { name: 'Run check', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Issues found' })).toBeVisible()
  await expect(page.getByLabel('Storage check results')).toContainText('OBJECT_CHECKSUM_MISMATCH')
  await expect(page.getByLabel('Storage check results')).toContainText('note.txt')

  await openMenu()
  await page.getByRole('menuitem', { name: 'Switch to dark theme', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: testInfo.outputPath('admin-mobile-dark.png'), fullPage: true })

  await environment.app.db.updateTable('users').set({ is_admin: false }).where('email', '=', user.email).execute()
  await page.getByRole('button', { name: 'Run check', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Access denied', exact: true })).toBeVisible()
  await expect(page.getByLabel('Storage check results')).toHaveCount(0)
  await openMenu()
  await expect(page.getByRole('menuitem', { name: 'Site administration', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await signOut(page, user)
})
