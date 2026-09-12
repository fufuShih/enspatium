import { test, expect } from './fixtures.js'
import { createSpace, register, signIn } from './helpers.js'

test('admin starts repository maintenance, returns to its result and sees a failed check', async ({ page, environment }, testInfo) => {
  const user = await register(page, 'Git administrator')
  await signIn(page, user)
  const space = await createSpace(page, 'Trial maintenance')
  expect((await page.request.get('/api/admin/git/maintenance')).status()).toBe(403)
  await environment.app.db.updateTable('users').set({ is_admin: true }).where('email', '=', user.email).execute()
  await page.goto('/settings/admin')
  await page.getByRole('button', { name: 'Git', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Git maintenance', exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Search Git Spaces', exact: true }).fill('Trial maintenance')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  const maintain = page.getByRole('button', { name: `Maintain ${space.account}/${space.slug}`, exact: true })
  await maintain.click()
  await expect(page.getByRole('dialog')).toContainText('Storage writes pause for the whole job.')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await (await page.request.get('/api/admin/git/maintenance')).json()).job).toBeNull()
  await maintain.click()
  await page.getByRole('button', { name: 'Start maintenance', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'System', exact: true }).click()
  await page.getByRole('button', { name: 'Git', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Maintenance completed', { timeout: 20_000 })
  await page.screenshot({ path: testInfo.outputPath('git-maintenance.png'), fullPage: true })

  const minimum = environment.app.config.STORAGE_MIN_FREE_BYTES
  environment.app.config.STORAGE_MIN_FREE_BYTES = Number.MAX_SAFE_INTEGER
  try {
    await maintain.click()
    await page.getByRole('button', { name: 'Start maintenance', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('Maintenance failed', { timeout: 20_000 })
    await expect(page.getByText('Not enough free disk space for repacking and the configured reserve.', { exact: true })).toBeVisible()
  } finally { environment.app.config.STORAGE_MIN_FREE_BYTES = minimum }
  await page.getByRole('button', { name: 'User menu for ' + user.name, exact: true }).click()
  await page.getByRole('menuitem', { name: 'Switch to dark theme', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: testInfo.outputPath('git-maintenance-mobile.png'), fullPage: true })
  await environment.app.db.updateTable('users').set({ is_admin: false }).where('email', '=', user.email).execute()
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Access denied', exact: true })).toBeVisible()
})
