import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { GetSpace200 } from '../src/api/generated/api.schemas.js'
import { test, expect } from './fixtures.js'
import { createSpace, register, signIn } from './helpers.js'

test('Raw and Download use the displayed commit for text, binary, large and empty files', async ({ page, environment }, testInfo) => {
  const user = await register(page, 'File owner')
  await signIn(page, user)
  const space = await createSpace(page, 'Download project')
  const metadata = await (await page.request.get(`/api/namespaces/${space.account}/spaces/${space.slug}`)).json() as GetSpace200
  const source = join(environment.root, 'file-download-' + metadata.id)
  await environment.git(['clone', join(environment.root, 'data', metadata.id), source])
  const git = (args: string[]) => environment.git(['-C', source, ...args])
  await git(['config', 'core.autocrlf', 'false'])
  const original = '# First version\r\n'
  const binary = Buffer.from([0, 1, 0, 10])
  const large = Buffer.alloc(1024 * 1024 + 4096, 65)
  const html = '<script>globalThis.executed = true</script>\n'
  const filename = "中文 #'().html"
  await mkdir(join(source, 'docs'))
  await writeFile(join(source, 'README.md'), original)
  await writeFile(join(source, 'binary.bin'), binary)
  await writeFile(join(source, 'large.txt'), large)
  await writeFile(join(source, 'empty.txt'), '')
  await writeFile(join(source, 'docs', filename), html)
  await git(['add', '.'])
  await git(['commit', '-m', 'Download fixtures'])
  await git(['push', 'origin', 'HEAD:main'])
  await git(['branch', 'original'])
  await git(['push', 'origin', 'original'])
  const first = (await git(['rev-parse', 'HEAD'])).stdout.trim()
  await page.reload()
  await page.getByRole('link', { name: 'View source', exact: true }).click()
  await expect(page.getByLabel('File contents')).toContainText('First version')
  await expect(page).toHaveURL(new RegExp(`commit=${first}$`))
  const file = page.getByRole('region', { name: 'Repository file', exact: true })
  const rawLink = file.getByRole('link', { name: 'Raw', exact: true })
  const downloadLink = file.getByRole('link', { name: 'Download', exact: true })
  async function download(expected: Buffer, name: string) {
    const downloading = page.waitForEvent('download')
    await downloadLink.click()
    const result = await downloading
    expect(result.suggestedFilename()).toBe(name)
    expect((await readFile((await result.path())!)).equals(expected)).toBe(true)
  }
  // A push while the file is open must not redirect either action to newer bytes.
  await writeFile(join(source, 'README.md'), '# New version\n')
  await git(['add', '.'])
  await git(['commit', '-m', 'Update while viewing'])
  await git(['push', 'origin', 'HEAD:main'])
  const popupPromise = page.waitForEvent('popup')
  await rawLink.click()
  const popup = await popupPromise
  await expect(popup.locator('body')).toContainText('First version')
  expect(new URL(popup.url()).searchParams.get('ref')).toBe(first)
  await popup.close()
  await download(Buffer.from(original), 'README.md')
  await page.reload()
  await expect(page.getByLabel('File contents')).toContainText('First version')
  await page.screenshot({ path: testInfo.outputPath('git-file-download.png'), fullPage: true })

  // Branch-only deep links resolve and pin a snapshot, including large files.
  const url = new URL(page.url())
  url.searchParams.delete('commit')
  url.searchParams.set('ref', 'original')
  url.searchParams.set('path', 'large.txt')
  await page.goto(url.href)
  await expect(page.getByRole('heading', { name: 'Preview unavailable', exact: true })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`commit=${first}$`))
  await download(large, 'large.txt')
  for (const [path, heading, contents] of [['binary.bin', 'Binary file', binary], ['empty.txt', 'This file is empty', Buffer.alloc(0)]] as const) {
    url.searchParams.set('path', path)
    await page.goto(url.href)
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
    await download(contents, path)
  }
  url.searchParams.set('path', 'docs/' + filename)
  await page.goto(url.href)
  await expect(page.getByLabel('File contents')).toContainText(html.trim())
  const rawPopup = page.waitForEvent('popup')
  await rawLink.click()
  const htmlPage = await rawPopup
  await expect(htmlPage.locator('body')).toContainText(html.trim())
  expect(await htmlPage.evaluate(() => 'executed' in globalThis)).toBe(false)
  expect(await htmlPage.evaluate(() => document.contentType)).toBe('text/plain')
  await htmlPage.close()
  await download(Buffer.from(html), filename)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(rawLink).toBeVisible()
  await expect(downloadLink).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('git-file-download-mobile.png'), fullPage: true })

  // Switching branch clears the pinned file and shows that branch's current tree.
  await page.getByLabel('Branch', { exact: true }).selectOption('main')
  await page.getByRole('link', { name: 'View source', exact: true }).click()
  await expect(page.getByLabel('File contents')).toContainText('New version')
  await download(Buffer.from('# New version\n'), 'README.md')
  url.searchParams.set('path', 'missing.txt')
  await page.goto(url.href)
  await expect(page.getByRole('heading', { name: 'Unable to open file', exact: true })).toBeVisible()
  await expect(rawLink).toHaveCount(0)
  await expect(downloadLink).toHaveCount(0)
})
