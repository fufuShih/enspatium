import { randomUUID } from 'node:crypto'
import { test, expect } from './fixtures.js'
import { createSpace, register, signIn } from './helpers.js'

test('admin creates and disables invited accounts while public registration is closed', async ({ page, browser, environment }, testInfo) => {
  const admin = await register(page, 'Access admin')
  await environment.app.db.updateTable('users').set({ is_admin: true }).where('email', '=', admin.email).execute()
  await signIn(page, admin)
  environment.app.config.REGISTRATION_ENABLED = false
  const other = await browser.newContext({ baseURL: environment.webOrigin })
  try {
    const memberPage = await other.newPage()
    await memberPage.goto('/register')
    await expect(memberPage.getByRole('heading', { name: 'Registration is closed', exact: true })).toBeVisible()
    await expect(memberPage.getByLabel('Password', { exact: true })).toHaveCount(0)
    await memberPage.getByRole('main').getByRole('link', { name: 'Sign in', exact: true }).click()
    await expect(memberPage.getByRole('link', { name: 'Create account', exact: true })).toHaveCount(0)
    await page.goto('/settings/admin')
    await page.getByRole('button', { name: 'Users', exact: true }).click()
    await page.getByRole('button', { name: 'Create user', exact: true }).click()
    const member = { name: 'Invited reader', email: randomUUID() + '@example.test', password: randomUUID() }
    const form = page.getByRole('form', { name: 'Create user', exact: true })
    await form.getByLabel('Name', { exact: true }).fill(member.name)
    await form.getByLabel('Email', { exact: true }).fill(member.email)
    await form.getByLabel('Password', { exact: true }).fill(member.password)
    await form.getByRole('button', { name: 'Save user', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Account created.')
    await page.getByLabel('Search users', { exact: true }).fill(member.email)
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await signIn(memberPage, member)
    const space = await createSpace(memberPage, 'Keep repository')
    const tokens = await memberPage.request.post('/api/auth/tokens', { data: { name: 'Old token', scopes: ['git:read'] } })
    expect(tokens.status()).toBe(201)
    await page.getByRole('button', { name: 'Disable ' + member.email, exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
    expect((await memberPage.request.get('/api/auth/me')).status()).toBe(200)
    await page.getByRole('button', { name: 'Disable ' + member.email, exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm disable', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Account disabled.')
    await memberPage.reload()
    await expect(memberPage.getByRole('heading', { name: 'Sign in to view this Space', exact: true })).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('admin-users-mobile.png'), fullPage: true, animations: 'disabled' })
    await page.getByRole('button', { name: 'Enable ' + member.email, exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm enable', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Account enabled.')
    await signIn(memberPage, member)
    await memberPage.goto(space.url)
    await expect(memberPage.getByRole('heading', { name: 'Keep repository', exact: true })).toBeVisible()
    const old = await tokens.json()
    expect((await memberPage.request.get(`/api/git/${space.account}/${space.slug}.git/info/refs?service=git-upload-pack`, { headers: { authorization: 'Basic ' + Buffer.from('git:' + old.token).toString('base64') } })).status()).toBe(401)
    await memberPage.goto('/settings/admin')
    await expect(memberPage.getByRole('heading', { name: 'Access denied', exact: true })).toBeVisible()
  } finally {
    environment.app.config.REGISTRATION_ENABLED = true
    await other.close()
  }
})
