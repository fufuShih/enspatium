import { test, expect } from './fixtures.js'
import { register, signIn } from './helpers.js'

test('admin system status shows health and low-disk alerts in both themes', async ({ page, environment }, testInfo) => {
  const user = await register(page, 'System admin')
  await signIn(page, user)
  expect((await page.request.get('/api/admin/operations')).status()).toBe(403)
  await environment.app.db.updateTable('users').set({ is_admin: true }).where('email', '=', user.email).execute()
  await page.goto('/settings/admin')
  await expect(page.getByRole('heading', { name: 'System checks', exact: true })).toBeVisible()
  await expect(page.getByRole('status', { exact: true })).toHaveText('Healthy')
  await expect(page.getByText('No server errors recorded.', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('system-status.png'), fullPage: true })
  const minimum = environment.app.config.STORAGE_MIN_FREE_BYTES
  environment.app.config.STORAGE_MIN_FREE_BYTES = Number.MAX_SAFE_INTEGER
  try {
    await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
    await expect(page.getByRole('status', { exact: true })).toHaveText('Needs attention')
    await expect(page.getByRole('alert')).toContainText('Free disk space is below the configured reserve.')
    await page.getByRole('button', { name: 'User menu for ' + user.name, exact: true }).click()
    await page.getByRole('menuitem', { name: 'Switch to dark theme', exact: true }).click()
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: testInfo.outputPath('system-low-disk-mobile.png'), fullPage: true })
  } finally { environment.app.config.STORAGE_MIN_FREE_BYTES = minimum }
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
  await expect(page.getByRole('status', { exact: true })).toHaveText('Healthy')
  await environment.app.db.updateTable('users').set({ is_admin: false }).where('email', '=', user.email).execute()
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Access denied', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'System status', exact: true })).toHaveCount(0)
})
