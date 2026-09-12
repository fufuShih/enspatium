import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './fixtures.js'
import { createSpace, register, signIn } from './helpers.js'

test('repository storage shows limits and refreshes after an HTTP push', async ({ page, environment }, testInfo) => {
  await signIn(page, await register(page, 'Storage owner'))
  const space = await createSpace(page, 'Storage usage')
  const storage = page.getByRole('region', { name: 'Repository storage', exact: true })
  await expect(storage).toContainText('Git objects: 0 B / 1,024 MiB')
  await expect(storage).toContainText('Push limit: 100 MiB')
  const tokenResponse = await page.request.post('/api/auth/tokens', { data: { name: 'Browser test push', scopes: ['git:read', 'git:write'] } })
  expect(tokenResponse.status()).toBe(201)
  const { token } = await tokenResponse.json() as { token: string }
  const source = join(environment.root, 'git-storage-ui')
  const remote = environment.webOrigin + `/api/git/${space.account}/${space.slug}.git`
  await environment.git(['clone', remote, source], token)
  await writeFile(join(source, 'README.md'), '# Storage usage\n')
  await environment.git(['-C', source, 'add', '.'])
  await environment.git(['-C', source, 'commit', '-m', 'First commit'])
  await environment.git(['-C', source, 'push', 'origin', 'HEAD:main'], token)
  await storage.getByRole('button', { name: 'Refresh storage usage' }).click()
  await expect(storage).not.toContainText('Git objects: 0 B')
  await page.reload()
  await expect(page.getByRole('link', { name: 'View source', exact: true })).toBeVisible()
  await expect(storage).toContainText('Push limit: 100 MiB')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(storage).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('git-storage-mobile.png'), fullPage: true })
})
