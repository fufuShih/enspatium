import type { APIRequestContext, Page } from '@playwright/test'
import { test, expect } from './fixtures.js'
import { createSpace, register, signIn, signOut } from './helpers.js'

async function upload(request: APIRequestContext, base: string, key: string, contents = key) {
  const response = await request.put(base + '/objects/' + encodeURIComponent(key), { data: Buffer.from(contents), headers: { 'content-type': 'text/plain' } })
  expect(response.status()).toBe(201)
  return response.json()
}
async function head(request: APIRequestContext, base: string, key: string) {
  const response = await request.get(base + '/object-head?' + new URLSearchParams({ key }))
  expect(response.status()).toBe(200)
  return response.json()
}
async function confirm(page: Page) {
  await page.getByRole('button', { name: 'Delete selected', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm delete', exact: true }).click()
}

test('selection stays on the current page, excludes folders, confirms deletion and preserves recoverable versions', async ({ page }, testInfo) => {
  const user = await register(page, 'Selection owner')
  await signIn(page, user)
  const space = await createSpace(page, 'Selected files', undefined, 'object')
  const base = `/api/namespaces/${space.account}/spaces/${space.slug}`
  for (let i = 0; i < 103; i++) await upload(page.request, base, `file-${String(i).padStart(3, '0')}.txt`)
  await upload(page.request, base, 'docs/中文 #%.txt', 'Nested contents')
  await page.reload()
  const selectAll = page.getByRole('checkbox', { name: 'Select all files on this page', exact: true })
  await selectAll.check()
  await expect(page.getByText('99 selected', { exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox')).toHaveCount(100) // One folder, 99 files, and Select all.
  await page.getByRole('link', { name: 'Next page', exact: true }).click()
  await expect(selectAll).not.toBeChecked()
  await expect(page.getByRole('button', { name: 'Delete selected', exact: true })).toHaveCount(0)
  await selectAll.check()
  await expect(page.getByText('4 selected', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'First page', exact: true }).click()
  await expect(selectAll).not.toBeChecked()
  await page.getByRole('checkbox', { name: 'Select file-000.txt', exact: true }).check()
  await expect(selectAll).toBeChecked({ indeterminate: true })
  await page.getByLabel('Filter by filename prefix', { exact: true }).fill('file-00')
  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Select file-000.txt', exact: true })).not.toBeChecked()
  await selectAll.check()
  await expect(page.getByText('10 selected', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(selectAll).not.toBeChecked()
  await page.getByRole('checkbox', { name: 'Select file-000.txt', exact: true }).check()
  await page.getByRole('link', { name: 'Open folder docs/', exact: true }).click()
  await expect(selectAll).not.toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Select docs/中文 #%.txt', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Back to parent folder', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Select file-000.txt', exact: true })).toBeVisible()

  let deletes = 0
  page.on('request', request => { if (request.method() === 'DELETE') deletes++ })
  await selectAll.check()
  await expect(page.getByText('99 selected', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Delete selected', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Delete 99 files?', exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(deletes).toBe(0)
  await selectAll.uncheck()
  for (const key of ['file-000.txt', 'file-001.txt']) await page.getByRole('checkbox', { name: 'Select ' + key, exact: true }).check()
  await page.getByRole('button', { name: 'Delete selected', exact: true }).click()
  await expect(dialog.getByRole('listitem')).toHaveText(['file-000.txt', 'file-001.txt'])
  await page.screenshot({ path: testInfo.outputPath('confirm-batch-delete.png'), animations: 'disabled' })
  await dialog.getByRole('button', { name: 'Confirm delete', exact: true }).click()
  const results = page.getByRole('region', { name: 'Deletion results', exact: true })
  await expect(results.getByRole('status')).toHaveText('2 of 2 files deleted')
  await expect(page.getByRole('button', { name: 'Open file-000.txt', exact: true })).toHaveCount(0)
  expect((await head(page.request, base, 'file-102.txt')).isDeleted).toBe(false)
  expect((await head(page.request, base, 'docs/中文 #%.txt')).isDeleted).toBe(false)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await results.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('batch-delete-mobile.png'), animations: 'disabled' })
  await page.getByRole('link', { name: 'Deleted files', exact: true }).click()
  await expect(page.getByRole('checkbox')).toHaveCount(0)
  await page.getByRole('button', { name: 'Open file-000.txt', exact: true }).click()
  await dialog.getByRole('button', { name: 'Restore version 1', exact: true }).click()
  await dialog.getByRole('button', { name: 'Confirm restore', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.getByRole('link', { name: 'Files', exact: true }).click()
  await page.getByRole('button', { name: 'Open file-000.txt', exact: true }).click()
  await expect(dialog.getByLabel('File contents', { exact: true })).toHaveText('file-000.txt')
})

test('partial failures retain the original version and lost responses can be retried without deleting new content', async ({ page }, testInfo) => {
  const user = await register(page, 'Delete retry owner')
  await signIn(page, user)
  const space = await createSpace(page, 'Delete retries', undefined, 'object')
  const base = `/api/namespaces/${space.account}/spaces/${space.slug}`
  const keys = ['a-changed.txt', 'b-failed.txt', 'c-lost.txt', 'd-success.txt']
  for (const key of keys) await upload(page.request, base, key)
  await page.reload()
  await page.getByRole('checkbox', { name: 'Select all files on this page', exact: true }).check()
  await page.getByRole('button', { name: 'Delete selected', exact: true }).click()
  // A concurrent edit after confirmation opens must not change its target version.
  const updated = await upload(page.request, base, keys[0]!, 'New contents')
  await page.route('**/objects/b-failed.txt?*', async route => { await route.abort('failed') })
  await page.route('**/objects/c-lost.txt?*', async route => {
    const response = await route.fetch()
    expect(response.status()).toBe(204)
    await route.abort('failed')
  })
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm delete', exact: true }).click()
  const results = page.getByRole('region', { name: 'Deletion results', exact: true })
  await expect(results.getByRole('status')).toHaveText('1 of 4 files deleted · 3 failed')
  await expect(results).toContainText('Review it and select it again before deleting.')
  await expect(results.getByRole('button', { name: 'Retry deleting a-changed.txt', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Choose a file to upload', { exact: true })).toBeEnabled()
  await page.unroute('**/objects/b-failed.txt?*')
  await page.unroute('**/objects/c-lost.txt?*')
  await results.getByRole('button', { name: 'Retry remaining', exact: true }).click()
  await expect(results.getByRole('status')).toHaveText('3 of 4 files deleted · 1 failed')
  await expect(results).toContainText('Already in Deleted files.')
  expect((await head(page.request, base, keys[0]!)).versionId).toBe(updated.versionId)
  for (const key of keys.slice(1)) {
    const versions = await (await page.request.get(base + '/object-versions?' + new URLSearchParams({ key }))).json()
    expect(versions.versions).toHaveLength(2) // Original content and exactly one delete marker.
  }
  await page.screenshot({ path: testInfo.outputPath('batch-delete-retry.png'), fullPage: true, animations: 'disabled' })
  // A fresh explicit selection authorizes deletion of the new version.
  await page.getByRole('checkbox', { name: 'Select a-changed.txt', exact: true }).check()
  await confirm(page)
  await expect(results.getByRole('status')).toHaveText('1 of 1 files deleted')
})

test('stopping, changing folders, leaving and signing out cancel queued deletions', async ({ page }) => {
  test.setTimeout(120_000)
  const user = await register(page, 'Delete stop owner')
  await signIn(page, user)
  const space = await createSpace(page, 'Stop deletion', undefined, 'object')
  const base = `/api/namespaces/${space.account}/spaces/${space.slug}`
  await upload(page.request, base, 'docs/keep.txt')
  for (const action of ['stop', 'folder', 'leave', 'signout'] as const) {
    const first = action + '-first.txt'
    const next = action + '-next.txt'
    for (const key of [first, next]) await upload(page.request, base, key)
    await page.goto(space.url)
    for (const key of [first, next]) await page.getByRole('checkbox', { name: 'Select ' + key, exact: true }).check()
    const pattern = `**/objects/${first}?*`
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    let queuedRequests = 0
    const track = (request: { method(): string; url(): string }) => { if (request.method() === 'DELETE' && request.url().includes('/objects/' + next + '?')) queuedRequests++ }
    page.on('request', track)
    await page.route(pattern, async () => { entered(); await held })
    try {
      await confirm(page)
      await started
      const canceled = page.waitForEvent('requestfailed', request => request.method() === 'DELETE' && request.url().includes(`/objects/${first}?`))
      if (action === 'stop') {
        await page.getByRole('button', { name: 'Stop deleting', exact: true }).click()
        await expect(page.getByRole('region', { name: 'Deletion results', exact: true }).getByRole('status')).toHaveText('0 of 2 files deleted · 2 stopped')
      } else if (action === 'folder') {
        await page.getByRole('link', { name: 'Open folder docs/', exact: true }).click()
        await expect(page).toHaveURL(/path=docs%2F$/)
      } else if (action === 'leave') {
        await page.getByRole('link', { name: 'Settings', exact: true }).click()
        await expect(page).toHaveURL(/\/settings$/)
      } else await signOut(page, user)
      await canceled
    } finally { release(); await page.unroute(pattern); page.off('request', track) }
    if (action === 'signout') await signIn(page, user)
    expect(queuedRequests).toBe(0)
    expect((await head(page.request, base, next)).isDeleted).toBe(false)
    if (action === 'stop') {
      await page.getByRole('region', { name: 'Deletion results', exact: true }).getByRole('button', { name: 'Retry remaining', exact: true }).click()
      await expect(page.getByRole('region', { name: 'Deletion results', exact: true }).getByRole('status')).toHaveText('2 of 2 files deleted')
    }
  }
})

test('losing write permission stops the batch and restored permission allows an explicit retry', async ({ page, browser, environment }) => {
  const owner = await register(page, 'Delete team owner')
  await signIn(page, owner)
  const org = 'delete-team'
  expect((await page.request.post('/api/namespaces', { data: { name: 'Delete team', slug: org } })).status()).toBe(201)
  const space = await createSpace(page, 'Shared deletions', org, 'object')
  const base = `/api/namespaces/${space.account}/spaces/${space.slug}`
  for (const key of ['first.txt', 'next.txt']) await upload(page.request, base, key)
  const context = await browser.newContext({ baseURL: environment.webOrigin })
  try {
    const memberPage = await context.newPage()
    const user = await register(memberPage, 'Delete writer')
    expect((await page.request.post(`/api/namespaces/${org}/members`, { data: { email: user.email } })).status()).toBe(201)
    const added = await page.request.post(base + '/members', { data: { email: user.email, role: 'writer' } })
    expect(added.status()).toBe(201)
    const member = await added.json()
    await signIn(memberPage, user)
    await memberPage.goto(space.url)
    await memberPage.getByRole('checkbox', { name: 'Select all files on this page', exact: true }).check()
    await memberPage.getByRole('button', { name: 'Delete selected', exact: true }).click()
    expect((await page.request.patch(base + '/members/' + member.userId, { data: { role: 'reader' } })).status()).toBe(200)
    await memberPage.getByRole('dialog').getByRole('button', { name: 'Confirm delete', exact: true }).click()
    const results = memberPage.getByRole('region', { name: 'Deletion results', exact: true })
    await expect(results.getByRole('status')).toHaveText('0 of 2 files deleted · 1 failed · 1 stopped')
    await expect(results).toContainText('You need write access to delete files.')
    for (const key of ['first.txt', 'next.txt']) expect((await head(page.request, base, key)).isDeleted).toBe(false)
    expect((await page.request.patch(base + '/members/' + member.userId, { data: { role: 'writer' } })).status()).toBe(200)
    await results.getByRole('button', { name: 'Retry remaining', exact: true }).click()
    await expect(results.getByRole('status')).toHaveText('2 of 2 files deleted')
  } finally { await context.close() }
})
