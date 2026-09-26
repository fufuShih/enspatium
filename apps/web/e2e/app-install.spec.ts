import { test, expect } from './fixtures.js'
import { createSpace, register, signIn } from './helpers.js'

test('installation help, deferred prompts, dismissal, failure and app mode stay local to the App', async ({ page }, testInfo) => {
  const user = await register(page, 'Install owner')
  await signIn(page, user)
  const space = await createSpace(page, 'Install notebook', undefined, 'note')
  const api = `/api/namespaces/${space.account}/spaces/${space.slug}`
  const { id } = await (await page.request.get(api)).json() as { id: string }
  const base = `/app/note/${id}/`
  await page.goto(base)
  await expect(page.getByRole('link', { name: 'Note', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Installation help' })).toHaveCount(0)
  expect((await page.request.put(api + '/apps/' + id + '/pwa', { data: { name: 'Install notebook', pwa: { enabled: true, iconObjectId: null, themeColor: null, offlinePolicy: 'shell' }, publishAcknowledged: true } })).status()).toBe(200)
  await page.reload()
  await page.getByRole('button', { name: 'Installation help' }).click()
  const help = page.getByRole('dialog', { name: 'Install this app' })
  await expect(help).toContainText('Add to Home Screen')
  await expect(help).toContainText('Nothing is saved automatically')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('install-help-mobile.png'), animations: 'disabled' })
  await help.getByRole('button', { name: 'Close' }).click()

  async function prompt(outcome: 'accepted' | 'dismissed' | 'error') {
    await page.evaluate(outcome => {
      const target = window as Window & { promptCalls?: number }
      target.promptCalls = 0
      const event = new Event('beforeinstallprompt', { cancelable: true })
      Object.assign(event, { prompt: async () => { target.promptCalls!++; if (outcome === 'error') throw new Error('Prompt unavailable') }, userChoice: Promise.resolve({ outcome }) })
      window.dispatchEvent(event)
    }, outcome)
    await expect(page.getByRole('button', { name: 'Install app', exact: true })).toBeVisible()
    expect(await page.evaluate(() => (window as Window & { promptCalls?: number }).promptCalls)).toBe(0)
    await page.getByRole('button', { name: 'Install app', exact: true }).click()
    expect(await page.evaluate(() => (window as Window & { promptCalls?: number }).promptCalls)).toBe(1)
    await expect(page.getByRole('button', { name: 'Install app', exact: true })).toHaveCount(0)
  }
  await prompt('dismissed')
  await expect(page.getByRole('status').filter({ hasText: 'Installation dismissed' })).toBeVisible()
  await prompt('error')
  await expect(page.getByRole('status').filter({ hasText: 'install prompt is unavailable' })).toBeVisible()
  await prompt('accepted')
  await expect(page.getByRole('status').filter({ hasText: 'Installation requested' })).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')))
  await expect(page.getByText('App installed', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: /Files/ }).click()
  await expect(page.getByRole('button', { name: 'Installation help' })).toHaveCount(0)
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0)
})

test('offline notes keep unsaved drafts, disable writes and never replay saves on reconnect', async ({ page, context }) => {
  const user = await register(page, 'Offline note owner')
  await signIn(page, user)
  const space = await createSpace(page, 'Offline note', undefined, 'note')
  const api = `/api/namespaces/${space.account}/spaces/${space.slug}`
  const { id } = await (await page.request.get(api)).json() as { id: string }
  const upload = await page.request.put(api + '/objects/Draft.md', { data: '# Original words', headers: { 'content-type': 'text/markdown' } })
  const note = await upload.json() as { id: string }
  await page.goto(`/app/note/${id}/note/${note.id}`)
  const editor = page.getByRole('textbox', { name: 'Note content', exact: true })
  await expect(editor).toContainText('Original words')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(' unsaved local draft')
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
  let writes = 0
  page.on('request', request => { if (request.method() === 'PUT' && request.url().includes('/objects/')) writes++ })
  await context.setOffline(true)
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await expect(editor).toHaveAttribute('contenteditable', 'false')
  await expect(page.getByRole('button', { name: 'Download draft' })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+s')
  expect(writes).toBe(0)
  await context.setOffline(false)
  await expect(editor).toHaveAttribute('contenteditable', 'true')
  await expect(editor).toContainText('unsaved local draft')
  expect(writes).toBe(0)
  expect(await (await page.request.get(api + '/objects/Draft.md')).text()).toBe('# Original words')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('status', { name: '' }).filter({ hasText: /^Saved$/ })).toBeVisible()
  expect(writes).toBe(1)
  expect(await page.evaluate(() => caches.keys())).toEqual([])
})
