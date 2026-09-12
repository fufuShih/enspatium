import type { APIRequestContext, Page } from '@playwright/test'
import { test, expect } from './fixtures.js'
import { createSpace, register, signIn, signOut } from './helpers.js'

async function upload(request: APIRequestContext, base: string, key: string, contents = key) {
  const response = await request.put(base + '/objects/' + encodeURIComponent(key), { headers: { 'content-type': 'text/plain' }, data: Buffer.from(contents) })
  expect(response.status()).toBe(201)
  return response.json()
}
async function head(request: APIRequestContext, base: string, key: string) {
  const response = await request.get(base + '/object-head?' + new URLSearchParams({ key }))
  expect(response.status()).toBe(200)
  return response.json()
}
async function prepare(page: Page, folder: string) {
  await page.getByRole('button', { name: 'Move selected', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Destination folder', { exact: true }).fill(folder)
}
async function confirm(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm move', exact: true }).click()
}

test('batch move previews paths, cancels safely, and preserves content and versions in nested and root folders', async ({ page }, testInfo) => {
  const user = await register(page, 'Batch move owner')
  await signIn(page, user)
  const space = await createSpace(page, 'Batch moves', undefined, 'object')
  const base = `/api/namespaces/${space.account}/spaces/${space.slug}`
  await upload(page.request, base, '中文 #%.txt', 'First')
  const before = await upload(page.request, base, '中文 #%.txt', 'Second')
  await upload(page.request, base, 'book.txt')
  await upload(page.request, base, 'keep/nested.txt')
  const usageBefore = await (await page.request.get(base + '/storage')).json()
  await page.reload()
  await page.getByRole('checkbox', { name: 'Select all files on this page', exact: true }).check()
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible()
  await prepare(page, '')
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Confirm move', exact: true })).toBeDisabled()
  await dialog.getByLabel('Destination folder', { exact: true }).fill('../invalid')
  await expect(dialog.getByRole('alert')).toContainText('Enter a valid folder path')
  await expect(dialog.getByRole('button', { name: 'Confirm move', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Select book.txt', exact: true })).toBeChecked()
  expect((await head(page.request, base, '中文 #%.txt')).versionId).toBe(before.versionId)
  await prepare(page, 'archive/books/')
  await expect(dialog.getByText('To: archive/books/中文 #%.txt', { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('batch-move-confirm-mobile.png'), animations: 'disabled' })
  await confirm(page)
  const results = page.getByRole('region', { name: 'Move results', exact: true })
  await expect(results.getByRole('status')).toHaveText('2 of 2 files moved')
  await expect(page.getByRole('button', { name: 'Open book.txt', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Move selected', exact: true })).toHaveCount(0)
  expect(await (await page.request.get(base + '/storage')).json()).toEqual(usageBefore)
  const key = 'archive/books/中文 #%.txt'
  expect(await head(page.request, base, key)).toMatchObject({ id: before.id, versionId: before.versionId, revision: before.revision })
  const history = await (await page.request.get(base + '/object-versions?' + new URLSearchParams({ key }))).json()
  expect(history.versions).toHaveLength(2)
  expect(await (await page.request.get(base + '/objects/' + encodeURIComponent(key))).text()).toBe('Second')
  expect((await head(page.request, base, 'keep/nested.txt')).key).toBe('keep/nested.txt')
  await results.scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('batch-move-results-mobile.png'), animations: 'disabled' })
  await results.getByRole('link', { name: 'Open destination folder', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('checkbox', { name: 'Select ' + key, exact: true })).not.toBeChecked()
  await page.getByRole('checkbox', { name: 'Select all files on this page', exact: true }).check()
  await prepare(page, '')
  await confirm(page)
  await expect(results.getByRole('status')).toHaveText('2 of 2 files moved')
  await results.getByRole('link', { name: 'Open destination folder', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Open book.txt', exact: true })).toBeVisible()
})

test('batch retries preserve original preconditions, skip changed sources, and never overwrite conflicts', async ({ page }) => {
  const user = await register(page, 'Batch retry owner')
  await signIn(page, user)
  const space = await createSpace(page, 'Batch retry', undefined, 'object')
  const base = `/api/namespaces/${space.account}/spaces/${space.slug}`
  const keys = ['a-changed.txt', 'b-conflict.txt', 'c-lost.txt', 'd-network.txt', 'e-success.txt']
  for (const key of keys) await upload(page.request, base, key)
  const conflict = await upload(page.request, base, 'archive/b-conflict.txt', 'Keep me')
  await page.reload()
  await page.getByRole('checkbox', { name: 'Select all files on this page', exact: true }).check()
  await prepare(page, 'archive')
  const updated = await upload(page.request, base, keys[0]!, 'Concurrent contents')
  const requests: Record<string, string>[] = []
  await page.route('**/object-move?*', async route => {
    const params = Object.fromEntries(new URL(route.request().url()).searchParams)
    requests.push(params)
    if (params.key === 'c-lost.txt') { expect((await route.fetch()).status()).toBe(200); await route.abort('failed') }
    else if (params.key === 'd-network.txt') await route.abort('failed')
    else await route.continue()
  })
  await confirm(page)
  const results = page.getByRole('region', { name: 'Move results', exact: true })
  await expect(results.getByRole('status')).toHaveText('1 of 5 files moved · 4 failed')
  await expect(results).toContainText('Review it and select it again.')
  await expect(results).toContainText('Nothing was overwritten.')
  await expect(results.getByRole('button', { name: 'Retry moving a-changed.txt', exact: true })).toHaveCount(0)
  expect(await (await page.request.get(base + '/objects/' + encodeURIComponent('archive/b-conflict.txt'))).text()).toBe('Keep me')
  expect((await head(page.request, base, keys[0]!)).versionId).toBe(updated.versionId)
  await page.unroute('**/object-move?*')
  // Resolve the name collision without deleting its retained history.
  expect((await page.request.post(base + '/object-move?' + new URLSearchParams({ objectId: conflict.id, key: conflict.key, newKey: 'archive/keep.txt', expectedVersion: conflict.versionId }))).status()).toBe(200)
  await page.route('**/object-move?*', async route => {
    const params = Object.fromEntries(new URL(route.request().url()).searchParams)
    expect(params).toEqual(requests.find(request => request.key === params.key))
    await route.continue()
  })
  await results.getByRole('button', { name: 'Retry moving d-network.txt', exact: true }).click()
  await expect(results.getByRole('status')).toHaveText('2 of 5 files moved · 3 failed')
  await results.getByRole('button', { name: 'Retry remaining moves', exact: true }).click()
  await expect(results.getByRole('status')).toHaveText('4 of 5 files moved · 1 failed')
  await expect(results.getByRole('button', { name: 'Retry remaining moves', exact: true })).toHaveCount(0)
  const audit = await (await page.request.get(base + '/audit-events')).json()
  expect(audit.filter((event: { action: string }) => event.action === 'object.moved')).toHaveLength(5) // Four sources plus the conflict resolution; lost response adds no duplicate.
})

test('stop, folder navigation, leaving and signing out cancel queued moves; stopped items can be retried', async ({ page }) => {
  test.setTimeout(120_000)
  const user = await register(page, 'Batch stop owner')
  await signIn(page, user)
  const space = await createSpace(page, 'Batch stop', undefined, 'object')
  const base = `/api/namespaces/${space.account}/spaces/${space.slug}`
  await upload(page.request, base, 'docs/keep.txt')
  for (const action of ['stop', 'folder', 'leave', 'signout'] as const) {
    const first = action + '-first.txt'
    const next = action + '-next.txt'
    for (const key of [first, next]) await upload(page.request, base, key)
    await page.goto(space.url)
    for (const key of [first, next]) await page.getByRole('checkbox', { name: 'Select ' + key, exact: true }).check()
    await prepare(page, 'archive')
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    let queuedRequests = 0
    await page.route('**/object-move?*', async route => {
      const key = new URL(route.request().url()).searchParams.get('key')
      if (key === first) { entered(); await held }
      else { if (key === next) queuedRequests++; await route.continue() }
    })
    try {
      await confirm(page)
      await started
      await expect(page.getByLabel('Choose a file to upload', { exact: true })).toBeDisabled()
      await expect(page.getByRole('button', { name: 'Open ' + next, exact: true })).toBeDisabled()
      const canceled = page.waitForEvent('requestfailed', request => request.url().includes('/object-move?') && new URL(request.url()).searchParams.get('key') === first)
      if (action === 'stop') {
        await page.getByRole('button', { name: 'Stop moving', exact: true }).click()
        await expect(page.getByRole('region', { name: 'Move results', exact: true }).getByRole('status')).toHaveText('0 of 2 files moved · 2 stopped')
      } else if (action === 'folder') await page.getByRole('link', { name: 'Open folder docs/', exact: true }).click()
      else if (action === 'leave') await page.getByRole('link', { name: 'Settings', exact: true }).click()
      else await signOut(page, user)
      await canceled
    } finally { release(); await page.unroute('**/object-move?*') }
    if (action === 'signout') await signIn(page, user)
    expect(queuedRequests).toBe(0)
    expect((await head(page.request, base, next)).key).toBe(next)
    if (action === 'stop') {
      await page.getByRole('button', { name: 'Retry remaining moves', exact: true }).click()
      await expect(page.getByRole('region', { name: 'Move results', exact: true }).getByRole('status')).toHaveText('2 of 2 files moved')
    }
  }
})

test('losing write permission stops queued moves until an explicit retry after permission is restored', async ({ page, browser, environment }) => {
  const owner = await register(page, 'Batch team owner')
  await signIn(page, owner)
  const org = 'batch-move-team'
  expect((await page.request.post('/api/namespaces', { data: { name: 'Batch move team', slug: org } })).status()).toBe(201)
  const space = await createSpace(page, 'Shared moves', org, 'object')
  const base = `/api/namespaces/${space.account}/spaces/${space.slug}`
  for (const key of ['first.txt', 'next.txt']) await upload(page.request, base, key)
  const context = await browser.newContext({ baseURL: environment.webOrigin })
  try {
    const memberPage = await context.newPage()
    const user = await register(memberPage, 'Batch writer')
    expect((await page.request.post(`/api/namespaces/${org}/members`, { data: { email: user.email } })).status()).toBe(201)
    const added = await page.request.post(base + '/members', { data: { email: user.email, role: 'writer' } })
    expect(added.status()).toBe(201)
    const member = await added.json()
    await signIn(memberPage, user)
    await memberPage.goto(space.url)
    await memberPage.getByRole('checkbox', { name: 'Select all files on this page', exact: true }).check()
    await prepare(memberPage, 'archive')
    expect((await page.request.patch(base + '/members/' + member.userId, { data: { role: 'reader' } })).status()).toBe(200)
    await confirm(memberPage)
    const results = memberPage.getByRole('region', { name: 'Move results', exact: true })
    await expect(results.getByRole('status')).toHaveText('0 of 2 files moved · 1 failed · 1 stopped')
    await expect(results).toContainText('You need write access to move files.')
    for (const key of ['first.txt', 'next.txt']) expect((await head(page.request, base, key)).key).toBe(key)
    expect((await page.request.patch(base + '/members/' + member.userId, { data: { role: 'writer' } })).status()).toBe(200)
    await results.getByRole('button', { name: 'Retry remaining moves', exact: true }).click()
    await expect(results.getByRole('status')).toHaveText('2 of 2 files moved')
  } finally { await context.close() }
})
