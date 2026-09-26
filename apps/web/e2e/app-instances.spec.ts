import { readFile } from 'node:fs/promises'
import { test, expect } from './fixtures.js'
import { createSpace, register, signIn } from './helpers.js'
import { epubFixture } from './ebook-fixtures.js'
import { createAppInstance, deleteAppInstance, updateAppInstance } from '../../../packages/server/src/services/app-instances.js'

test('independent App IDs share Space content and preserve deep links, login returns and legacy entries', async ({ page, browser, environment }) => {
  test.setTimeout(120_000)
  const user = await register(page, 'Instance owner')
  await signIn(page, user)
  const space = await createSpace(page, 'Shared notebook', undefined, 'note')
  const base = `/api/namespaces/${space.account}/spaces/${space.slug}`
  const { id: spaceId } = await (await page.request.get(base)).json() as { id: string }
  const actor = await environment.app.db.selectFrom('users').select('id').where('email', '=', user.email).executeTakeFirstOrThrow()
  const args = [environment.app.db, actor.id, space.account, space.slug] as const
  const notebook = await createAppInstance(...args, { appType: 'note', name: 'Second notebook' })
  const library = await createAppInstance(...args, { appType: 'ebook', name: 'Shared bookshelf' })
  const gallery = await createAppInstance(...args, { appType: 'media', name: 'Shared photos' })
  expect(new Set([spaceId, notebook.id, library.id, gallery.id]).size).toBe(4)
  const noteUpload = await page.request.put(base + '/objects/Shared.md', { data: '# Shared words', headers: { 'content-type': 'text/markdown' } })
  expect(noteUpload.status()).toBe(201)
  const note = await noteUpload.json() as { id: string }
  expect((await page.request.put(base + '/objects/Story.epub', { data: epubFixture(), headers: { 'content-type': 'application/epub+zip' } })).status()).toBe(201)
  expect((await page.request.put(base + '/objects/photo.png', { data: await readFile(new URL('./media-fixtures/photo.png', import.meta.url)), headers: { 'content-type': 'image/png' } })).status()).toBe(201)

  // Bookmarks without a trailing slash and old UUIDs continue to work.
  await page.goto(`/app/note/${spaceId}`)
  await expect(page).toHaveTitle('Shared notebook · Note')
  await expect(page.getByRole('link', { name: 'Open Shared.md' })).toHaveAttribute('href', `/app/note/${spaceId}/note/${note.id}`)
  await page.goto(`/app/note/${notebook.id}/`)
  await expect(page).toHaveTitle('Second notebook · Note')
  await expect(page.getByRole('link', { name: 'Files ↗' })).toHaveAttribute('href', space.url)
  const link = page.getByRole('link', { name: 'Open Shared.md' })
  const deepLink = `/app/note/${notebook.id}/note/${note.id}`
  await expect(link).toHaveAttribute('href', deepLink)
  await link.click()
  const editor = page.getByRole('textbox', { name: 'Note content', exact: true })
  await expect(editor).toContainText('Shared words')
  await page.reload()
  await expect(editor).toContainText('Shared words')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.insertText('\n\nFrom the second instance')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible()
  expect(await (await page.request.get(base + '/objects/Shared.md')).text()).toContain('From the second instance')
  await page.getByRole('button', { name: '+ New note', exact: true }).click()
  await page.getByLabel('Note name', { exact: true }).fill('Second note')
  await page.getByRole('button', { name: 'Create note', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Open Second note.md' })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/app/note/${notebook.id}/note/[^/]+$`))
  await updateAppInstance(...args, notebook.id, { name: 'Renamed notebook' })
  await page.goto(deepLink)
  await expect(page).toHaveTitle('Renamed notebook · Note')

  await page.goto(`/app/ebook/${library.id}/`)
  await expect(page.getByRole('heading', { name: 'Shared bookshelf' })).toBeVisible()
  const book = page.getByRole('link', { name: 'Read Story.epub' })
  expect(await book.getAttribute('href')).toMatch(new RegExp(`^/app/ebook/${library.id}/book/`))
  await book.click()
  await page.reload()
  await expect(page.frameLocator('iframe[title="EPUB chapter"]').getByRole('heading', { name: 'The beginning' })).toBeVisible()
  await page.getByRole('link', { name: /Back to library/ }).click()
  await expect(page).toHaveURL(`${environment.webOrigin}/app/ebook/${library.id}/`)
  await page.goto(`/app/media/${gallery.id}/`)
  await expect(page.getByRole('heading', { name: 'Shared photos' })).toBeVisible()
  await page.getByRole('button', { name: 'Open media photo.png' }).click()
  const photo = page.getByRole('region', { name: 'Now playing' }).getByRole('img')
  await expect(photo).toHaveAttribute('src', new RegExp(`/apps/media/instances/${gallery.id}/objects/content`))
  await expect.poll(() => photo.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)

  const guestContext = await browser.newContext()
  try {
    const guest = await guestContext.newPage()
    const returnUrl = environment.webOrigin + deepLink + '?search=Shared'
    await guest.goto(returnUrl)
    await expect(guest.getByRole('heading', { name: 'Sign in to open this app' })).toBeVisible()
    await guest.getByRole('link', { name: 'Sign in', exact: true }).click()
    await guest.getByLabel('Email', { exact: true }).fill(user.email)
    await guest.getByLabel('Password', { exact: true }).fill(user.password)
    await guest.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(guest).toHaveURL(returnUrl)
    await expect(guest.getByRole('textbox', { name: 'Note content' })).toContainText('From the second instance')
  } finally { await guestContext.close() }
  await deleteAppInstance(...args, spaceId)
  expect((await page.request.get(`/api/apps/note/spaces/${spaceId}`)).status()).toBe(404)
  await page.goto(`/app/note/${spaceId}/note/${note.id}`)
  await expect(page.getByRole('heading', { name: 'App not found' })).toBeVisible()
  await page.goto(deepLink)
  await expect(editor).toContainText('From the second instance')
  await deleteAppInstance(...args, notebook.id)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'App not found' })).toBeVisible()
  expect((await page.request.get(base + '/objects/Shared.md')).status()).toBe(200)
})
