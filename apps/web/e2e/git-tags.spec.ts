import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import type { GetSpace200 } from '../src/api/generated/api.schemas.js'
import { test, expect } from './fixtures.js'
import { createSpace, register, signIn, signOut } from './helpers.js'

test('tags retain their own files, history, links and ZIP when a branch has the same name', async ({ page, environment, request }, testInfo) => {
  const user = await register(page, 'Tag owner')
  await signIn(page, user)
  const space = await createSpace(page, 'Tag repository')
  const base = `/api/namespaces/${space.account}/spaces/${space.slug}`
  const metadata = await (await page.request.get(base)).json() as GetSpace200
  await page.goto(space.url + '?refType=tag')
  await expect(page.getByRole('heading', { name: 'No tags yet', exact: true })).toBeVisible()
  const work = join(environment.root, 'tags-seed')
  await environment.git(['clone', join(environment.root, 'data', metadata.id), work])
  const git = (args: string[]) => environment.git(['-C', work, ...args])
  await mkdir(join(work, 'docs'))
  await writeFile(join(work, 'README.md'), '# Tagged release\n')
  await writeFile(join(work, 'docs', 'version.txt'), 'Tag bytes\n')
  await git(['add', '.'])
  await git(['commit', '-m', 'Tagged commit'])
  const tagged = (await git(['rev-parse', 'HEAD'])).stdout.trim()
  await git(['tag', 'v1'])
  await git(['tag', '-a', 'annotated', '-m', 'Annotated release'])
  await git(['tag', '-a', 'release/首版', 'annotated', '-m', 'Nested annotated release'])
  await writeFile(join(work, 'README.md'), '# Branch development\n')
  await git(['add', '.'])
  await git(['commit', '-m', 'Branch commit'])
  await git(['push', 'origin', 'HEAD:main', 'HEAD:refs/heads/v1', '--tags'])
  expect((await request.get(base + '/git/tags')).status()).toBe(401)
  const tags = await (await page.request.get(base + '/git/tags')).json() as { name: string; commitId: string }[]
  expect(tags).toContainEqual({ name: 'v1', commitId: tagged })
  expect(tags).toContainEqual({ name: 'release/首版', commitId: tagged })
  await page.reload()
  await page.getByLabel('Tag', { exact: true }).selectOption('v1')
  await expect(page.getByRole('heading', { name: 'Tagged release', exact: true })).toBeVisible()
  await page.getByRole('link', { name: /^docs\/\s*Folder$/ }).click()
  expect(new URL(page.url()).searchParams.get('refType')).toBe('tag')
  await page.getByRole('link', { name: /^version.txt/ }).click()
  await expect(page.getByLabel('File contents', { exact: true })).toContainText('Tag bytes')
  await page.reload()
  await expect(page.getByLabel('Tag', { exact: true })).toHaveValue('v1')
  await expect(page.getByLabel('File contents', { exact: true })).toContainText('Tag bytes')
  await page.getByRole('navigation', { name: 'Repository views' }).getByRole('link', { name: 'Commits', exact: true }).click()
  const history = page.getByRole('region', { name: 'Commit history', exact: true })
  await expect(history.getByRole('link').filter({ hasText: 'Tagged commit' })).toBeVisible()
  await expect(history.getByRole('link').filter({ hasText: 'Branch commit' })).toHaveCount(0)
  await history.getByRole('link').filter({ hasText: 'Tagged commit' }).click()
  await expect(page.getByRole('region', { name: 'File diff', exact: true })).toContainText('+# Tagged release')
  await page.getByRole('button', { name: 'Clone', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download ZIP', exact: true }).click()
  const zip = await download
  const files = unzipSync(await readFile((await zip.path())!))
  const prefix = `${space.slug}-${tagged.slice(0, 7)}/`
  expect(strFromU8(files[prefix + 'README.md']!)).toBe('# Tagged release\n')
  expect(strFromU8(files[prefix + 'docs/version.txt']!)).toBe('Tag bytes\n')
  await page.keyboard.press('Escape')
  await page.getByLabel('Reference type', { exact: true }).selectOption('branch')
  await page.getByLabel('Branch', { exact: true }).selectOption('v1')
  await page.getByRole('navigation', { name: 'Repository views' }).getByRole('link', { name: 'Files', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Branch development', exact: true })).toBeVisible()
  await page.goto(space.url + '?refType=tag&ref=missing')
  await expect(page.getByRole('heading', { name: 'Tag not found', exact: true })).toBeVisible()
  await page.getByLabel('Tag', { exact: true }).selectOption('release/首版')
  await expect(page.getByRole('heading', { name: 'Tagged release', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('tag-browser.png'), fullPage: true })
  await page.getByRole('button', { name: 'User menu for ' + user.name, exact: true }).click()
  await page.getByRole('menuitem', { name: 'Switch to dark theme', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('tag-browser-mobile.png'), fullPage: true })
  // Legacy/imported repositories can contain tags without any branches. Seed
  // that shape directly in this disposable repository, outside HTTP protection.
  for (const branch of ['main', 'v1']) {
    await environment.git(['--git-dir=' + join(environment.root, 'data', metadata.id), 'update-ref', '-d', 'refs/heads/' + branch])
  }
  await page.goto(space.url)
  await expect(page.getByRole('heading', { name: 'No branches', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Browse tags', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Tagged release', exact: true })).toBeVisible()
  const tagUrl = page.url()
  await signOut(page, user)
  await page.goto(tagUrl)
  await expect(page.getByRole('heading', { name: 'Sign in to view this Space', exact: true })).toBeVisible()
})
