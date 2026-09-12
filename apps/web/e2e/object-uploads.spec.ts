import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './fixtures.js'
import { createSpace, register, signIn } from './helpers.js'

test('multiple files, selected folders and native directory drops keep their structure beyond 100 files', async ({ page, environment }, testInfo) => {
  test.setTimeout(120_000)
  const user = await register(page, 'Upload owner')
  await signIn(page, user)
  const space = await createSpace(page, 'Batch files', undefined, 'object')
  const base = `/api/namespaces/${space.account}/spaces/${space.slug}`
  await expect(page.getByLabel('Choose a file to upload', { exact: true })).toBeEnabled()
  await page.getByLabel('Choose a file to upload', { exact: true }).setInputFiles([
    { name: 'first.txt', mimeType: 'text/plain', buffer: Buffer.from('first') },
    { name: 'zero.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(0) },
  ])
  await expect(page.getByRole('status').filter({ hasText: '2 of 2 files uploaded.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open first.txt', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open zero.bin', exact: true })).toBeVisible()
  // The whole selected folder belongs under the current Object prefix.
  await page.getByRole('button', { name: 'New folder', exact: true }).click()
  await page.getByLabel('Folder name', { exact: true }).fill('uploads')
  await page.getByRole('button', { name: 'Open folder', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Folder path' }).getByRole('link', { name: 'uploads', exact: true })).toBeVisible()
  const album = join(environment.root, 'client-files', 'album')
  await mkdir(join(album, '中文 music'), { recursive: true })
  await mkdir(join(album, 'empty'), { recursive: true })
  await writeFile(join(album, 'cover.txt'), 'cover')
  await writeFile(join(album, '中文 music', 'song #1.txt'), 'song')
  await expect(page.getByLabel('Choose a folder to upload', { exact: true })).toBeEnabled()
  await page.getByLabel('Choose a folder to upload', { exact: true }).setInputFiles(album)
  await expect(page.getByLabel('Upload list')).toContainText('album/cover.txt')
  await expect(page.getByRole('status').filter({ hasText: '2 of 2 files uploaded.' })).toBeVisible()
  expect(await (await page.request.get(base + '/object-tree?prefix=uploads%2Falbum%2F')).json()).toMatchObject({ folders: ['uploads/album/中文 music/'] })
  const songKey = 'uploads/album/中文 music/song #1.txt'
  expect(await (await page.request.get(base + '/objects/' + encodeURIComponent(songKey))).text()).toBe('song')

  // Use Chromium's native drag data, not mocked directory entries or HTTP data.
  const bundle = join(environment.root, 'client-files', 'bundle')
  await mkdir(join(bundle, 'nested', 'empty'), { recursive: true })
  await Promise.all(Array.from({ length: 105 }, (_, i) => writeFile(join(bundle, `file-${String(i).padStart(3, '0')}.txt`), `contents ${i}`)))
  await writeFile(join(bundle, 'nested', '中文 %_#.txt'), 'nested drop')
  const loose = join(environment.root, 'client-files', 'loose.txt')
  await writeFile(loose, 'loose file')
  await page.getByLabel('File upload area').scrollIntoViewIfNeeded()
  const area = (await page.getByLabel('File upload area').boundingBox())!
  const cdp = await page.context().newCDPSession(page)
  const data = { items: [], files: [bundle, loose], dragOperationsMask: 1 }
  try {
    for (const type of ['dragEnter', 'dragOver', 'drop'] as const) await cdp.send('Input.dispatchDragEvent', { type, data, x: area.x + 20, y: area.y + 20 })
  } finally { await cdp.detach() }
  await expect(page.getByRole('status').filter({ hasText: '107 of 107 files uploaded.' })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('1 empty folder skipped.', { exact: true })).toBeVisible()
  const metadata = await (await page.request.get(base)).json()
  expect(await environment.app.db.selectFrom('space_objects').select('id').where('space_id', '=', metadata.id).execute()).toHaveLength(111)
  expect(await (await page.request.get(base + '/objects/' + encodeURIComponent('uploads/bundle/file-104.txt'))).text()).toBe('contents 104')
  expect(await (await page.request.get(base + '/objects/' + encodeURIComponent('uploads/bundle/nested/中文 %_#.txt'))).text()).toBe('nested drop')
  await page.screenshot({ path: testInfo.outputPath('folder-upload.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('folder-upload-mobile.png'), fullPage: true })
  await page.getByRole('button', { name: 'Clear list', exact: true }).click()
  await page.getByRole('link', { name: 'Open folder uploads/bundle/', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Open uploads/bundle/file-000.txt', exact: true })).toBeVisible()
})

test('partial failures retry safely and folder navigation never changes the queued destination', async ({ page, environment }, testInfo) => {
  const user = await register(page, 'Retry owner')
  await signIn(page, user)
  const space = await createSpace(page, 'Retry files', undefined, 'object')
  const base = `/api/namespaces/${space.account}/spaces/${space.slug}`
  const metadata = await (await page.request.get(base)).json()
  // Set a real quota: the first item fails, but the smaller second item fits.
  await environment.app.db.updateTable('spaces').set({ quota_bytes: '3' }).where('id', '=', metadata.id).execute()
  await expect(page.getByLabel('Choose a file to upload', { exact: true })).toBeEnabled()
  await page.getByLabel('Choose a file to upload', { exact: true }).setInputFiles([
    { name: 'large.txt', mimeType: 'text/plain', buffer: Buffer.from('large file') },
    { name: 'small.txt', mimeType: 'text/plain', buffer: Buffer.from('ok') },
  ])
  await expect(page.getByRole('status').filter({ hasText: '1 of 2 files uploaded.' })).toBeVisible()
  await expect(page.getByLabel('Upload list')).toContainText('available storage space')
  await environment.app.db.updateTable('spaces').set({ quota_bytes: '100000' }).where('id', '=', metadata.id).execute()
  await page.getByRole('button', { name: 'Retry large.txt', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '2 of 2 files uploaded.' })).toBeVisible()
  expect((await (await page.request.get(base + '/object-versions?key=small.txt')).json()).versions).toHaveLength(1)

  // Losing a real successful response is different from a rejected write.
  await page.route('**/objects/uncertain.txt?*', async route => {
    const response = await route.fetch()
    expect(response.status()).toBe(201)
    await route.abort('failed')
  })
  await page.getByLabel('Choose a file to upload', { exact: true }).setInputFiles({ name: 'uncertain.txt', mimeType: 'text/plain', buffer: Buffer.from('committed') })
  await expect(page.getByRole('status').filter({ hasText: '0 of 1 files uploaded.' })).toBeVisible()
  await page.unroute('**/objects/uncertain.txt?*')
  await page.getByRole('button', { name: 'Retry uncertain.txt', exact: true }).click()
  await expect(page.getByLabel('Upload list')).toContainText('Review its versions before uploading it again.')
  await expect(page.getByRole('button', { name: 'Retry uncertain.txt', exact: true })).toHaveCount(0)
  expect((await (await page.request.get(base + '/object-versions?key=uncertain.txt')).json()).versions).toHaveLength(1)
  await page.screenshot({ path: testInfo.outputPath('upload-review.png'), fullPage: true })

  // Hold one request so navigation occurs with another file still in the queue.
  let resume!: () => void
  const held = new Promise<void>(resolve => { resume = resolve })
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  await page.route('**/objects/held.txt?*', async route => { entered(); await held; await route.continue() })
  try {
    await page.getByLabel('Choose a file to upload', { exact: true }).setInputFiles([
      { name: 'held.txt', mimeType: 'text/plain', buffer: Buffer.from('held') },
      { name: 'next.txt', mimeType: 'text/plain', buffer: Buffer.from('next') },
    ])
    await started
    await page.getByRole('button', { name: 'New folder', exact: true }).click()
    await page.getByLabel('Folder name', { exact: true }).fill('elsewhere')
    await page.getByRole('button', { name: 'Open folder', exact: true }).click()
    await expect(page).toHaveURL(/path=elsewhere%2F$/)
    resume()
    await expect(page.getByRole('status').filter({ hasText: '2 of 2 files uploaded.' })).toBeVisible()
    expect((await page.request.get(base + '/objects/next.txt')).status()).toBe(200)
    expect((await page.request.get(base + '/objects/' + encodeURIComponent('elsewhere/next.txt'))).status()).toBe(404)
    await expect(page).toHaveURL(/path=elsewhere%2F$/)
  } finally { resume(); await page.unroute('**/objects/held.txt?*') }
})

test('stopping uploads and leaving the Space prevent queued files from being sent', async ({ page, environment }) => {
  const user = await register(page, 'Stop owner')
  await signIn(page, user)
  const space = await createSpace(page, 'Stop files', undefined, 'object')
  const base = `/api/namespaces/${space.account}/spaces/${space.slug}`
  const metadata = await (await page.request.get(base)).json()
  for (const action of ['stop', 'leave'] as const) {
    const first = `${action}-first.txt`
    const next = `${action}-next.txt`
    const pattern = `**/objects/${first}?*`
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    // The browser cancels this paused request; do not handle the route again afterward.
    await page.route(pattern, async () => { entered(); await held })
    try {
      await expect(page.getByLabel('Choose a file to upload', { exact: true })).toBeEnabled()
      await page.getByLabel('Choose a file to upload', { exact: true }).setInputFiles([first, next].map(name => ({ name, mimeType: 'text/plain', buffer: Buffer.from(name) })))
      await started
      const canceled = page.waitForEvent('requestfailed', request => request.url().includes(`/objects/${first}?`))
      if (action === 'stop') {
        await page.getByRole('button', { name: 'Stop uploads', exact: true }).click()
        await expect(page.getByLabel('Upload list')).toContainText('2 stopped')
        await expect(page.getByRole('status').filter({ hasText: '0 of 2 files uploaded.' })).toBeVisible()
      } else {
        await page.getByRole('link', { name: 'Settings', exact: true }).click()
        await expect(page).toHaveURL(/\/settings$/)
      }
      await canceled
    } finally { release(); await page.unroute(pattern) }
    expect((await page.request.get(base + '/objects/' + encodeURIComponent(next))).status()).toBe(404)
    if (action === 'stop') {
      await page.getByRole('button', { name: 'Retry remaining', exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: '2 of 2 files uploaded.' })).toBeVisible()
    }
  }
  const objects = await environment.app.db.selectFrom('space_objects').select('key').where('space_id', '=', metadata.id).execute()
  expect(objects.map(object => object.key).sort()).toEqual(['stop-first.txt', 'stop-next.txt'])
})
