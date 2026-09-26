import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { acquireStorageWrite } from '../../../packages/server/src/services/space/storage-access.js'
import { JobWorker } from '../../../packages/server/src/services/jobs/runner.js'
import { claimNextJob, failJob } from '../../../packages/server/src/services/jobs/queue.js'
import { randomUUID } from 'node:crypto'
import { test, expect } from './fixtures.js'
import { createSpace, register, signIn, signOut } from './helpers.js'

test('only admins see site administration and can inspect storage from the menu', async ({ page, environment }, testInfo) => {
  const worker = new JobWorker(environment.app, 50)
  try {
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
    page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/admin/jobs')) checks++ })
    await page.getByRole('menuitem', { name: 'Site administration', exact: true }).click()
    await expect(page).toHaveURL(/\/settings\/admin$/)
    await page.getByRole('button', { name: 'Storage', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Storage integrity', exact: true })).toBeVisible()
    expect(checks).toBe(0)
    await page.getByLabel('Space ID (optional)', { exact: true }).fill(metadata.id)
    await page.getByLabel('Check type', { exact: true }).selectOption('deep')
    await page.getByRole('button', { name: 'Run check', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Execution: Queued' })).toBeVisible()
    const firstJobUrl = page.url()
    // Leave before the worker starts: no HTTP request or open view owns the job.
    await page.goto('/')
    await worker.start()
    await page.goto('/settings/admin/jobs')
    await expect(page.getByRole('heading', { name: 'Background jobs' })).toBeVisible()
    await page.getByRole('link', { name: /^Storage check ·/ }).first().click()
    await expect(page).toHaveURL(firstJobUrl)
    await expect(page.getByRole('status').filter({ hasText: 'No issues found' })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Execution: Succeeded' })).toBeVisible()
    expect(checks).toBe(1)
    await expect(page.getByLabel('Storage check results')).toContainText('1 Space · 1 file checked')
    await page.screenshot({ path: testInfo.outputPath('admin-page.png'), fullPage: true })

    const runCheck = async () => {
      await page.getByRole('button', { name: 'Storage', exact: true }).click()
      await page.getByLabel('Space ID (optional)', { exact: true }).fill(metadata.id)
      await page.getByLabel('Check type', { exact: true }).selectOption('deep')
      await page.getByRole('button', { name: 'Run check', exact: true }).click()
    }

    const release = acquireStorageWrite(environment.app.config.DATA_ROOT)
    try {
      await runCheck()
      await expect(page.getByRole('status').filter({ hasText: 'Execution: Failed' })).toBeVisible()
      await expect(page.getByRole('alert')).toContainText('STORAGE_BUSY')
      await expect(page.getByLabel('Storage check results')).toHaveCount(0)
    } finally { release() }
    const failedJobUrl = page.url()
    await page.getByRole('button', { name: 'Retry job', exact: true }).click()
    await expect(page).not.toHaveURL(failedJobUrl)
    await expect(page.getByRole('status').filter({ hasText: 'No issues found' })).toBeVisible()
    await expect(page.getByRole('link', { name: failedJobUrl.split('/').at(-1)!, exact: true })).toBeVisible()

    const version = await environment.app.db.selectFrom('space_object_versions').select('storage_key').where('id', '=', object.versionId).executeTakeFirstOrThrow()
    // Only alter the isolated fixture's bytes to verify the report in the UI.
    await writeFile(join(environment.root, 'data', metadata.id, version.storage_key!), 'jello')
    await runCheck()
    await expect(page.getByRole('status').filter({ hasText: 'Issues found' })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Execution: Succeeded' })).toBeVisible()
    await expect(page.getByLabel('Storage check results')).toContainText('OBJECT_CHECKSUM_MISMATCH')
    await expect(page.getByLabel('Storage check results')).toContainText('note.txt')
    await page.reload()
    await expect(page.getByLabel('Storage check results')).toContainText('OBJECT_CHECKSUM_MISMATCH')
    let terminalPolls = 0
    page.on('request', request => { if (request.method() === 'GET' && request.url().includes('/api/admin/jobs/')) terminalPolls++ })
    // Verify that terminal reports do not keep the two-second polling loop alive.
    await page.waitForTimeout(2_400)
    expect(terminalPolls).toBe(0)

    await openMenu()
    await page.getByRole('menuitem', { name: 'Switch to dark theme', exact: true }).click()
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: testInfo.outputPath('admin-mobile-dark.png'), fullPage: true })

    await environment.app.db.updateTable('users').set({ is_admin: false }).where('email', '=', user.email).execute()
    await page.getByRole('button', { name: 'Refresh job', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Access denied', exact: true })).toBeVisible()
    await expect(page.getByLabel('Storage check results')).toHaveCount(0)
    await openMenu()
    await expect(page.getByRole('menuitem', { name: 'Site administration', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await signOut(page, user)
  } finally { await worker.close() }
})

test('Jobs supports queued cancellation, stale-state conflicts, filtering, pagination and missing jobs', async ({ page, environment }, testInfo) => {
  const user = await register(page, 'Jobs admin')
  await signIn(page, user)
  await environment.app.db.updateTable('users').set({ is_admin: true }).where('email', '=', user.email).execute()
  await page.goto('/settings/admin/jobs')
  const queued = await (await page.request.post('/api/admin/jobs', { data: { kind: 'storage.check', payload: {} } })).json()
  await page.goto('/settings/admin/jobs/' + queued.id)
  await expect(page.getByRole('button', { name: 'Cancel job', exact: true })).toBeVisible()
  // Advance the database behind the rendered view to exercise a real HTTP 409.
  await claimNextJob(environment.app.db)
  await page.getByRole('button', { name: 'Cancel job', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('The job state changed')
  await expect(page.getByRole('status').filter({ hasText: 'Execution: Running' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel job', exact: true })).toHaveCount(0)
  await failJob(environment.app.db, queued.id, { code: 'TEST_FAILURE', message: 'A simulated failure.' })
  await expect(page.getByRole('button', { name: 'Retry job', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Retry job', exact: true }).click()
  await expect(page).not.toHaveURL(new RegExp(queued.id + '$'))
  await page.getByRole('button', { name: 'Cancel job', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Execution: Cancelled' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cancel job', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Retry job', exact: true })).toHaveCount(0)

  // Seed enough terminal history to exercise the browser's cursor controls.
  await environment.app.db.insertInto('jobs').values(Array.from({ length: 33 }, () => ({
    kind: 'storage.check' as const, status: 'cancelled' as const, payload: { deep: false },
    created_at: new Date('2025-01-01T00:00:00Z'), finished_at: new Date('2025-01-01T00:01:00Z'),
    space_id: null, requested_by_user_id: null, result: null, error_code: null, error_message: null,
    started_at: null, retry_of_job_id: null,
  }))).execute()
  await page.getByRole('link', { name: 'Back to Jobs', exact: true }).click()
  await expect(page.getByRole('link', { name: /^Storage check ·/ })).toHaveCount(30)
  await page.screenshot({ path: testInfo.outputPath('jobs-list.png'), fullPage: true })
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByText('Page 2', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Previous', exact: true }).click()
  await expect(page.getByText('Page 1', { exact: true })).toBeVisible()
  await page.getByLabel('Job status', { exact: true }).selectOption('failed')
  await expect(page.getByRole('link', { name: 'Storage check · ' + queued.id.slice(0, 8), exact: true })).toBeVisible()
  await page.getByLabel('Job status', { exact: true }).selectOption('queued')
  await expect(page.getByText('No jobs match this status. Start a check from Storage.', { exact: true })).toBeVisible()
  await page.goto('/settings/admin/jobs/' + randomUUID())
  await expect(page.getByRole('heading', { name: 'Job not found', exact: true })).toBeVisible()
})
