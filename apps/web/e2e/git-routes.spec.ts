import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect } from './fixtures.js'
import { createSpace, register, signIn, signOut } from './helpers.js'

test('path routes preserve slash and literal percent refs, shared commits and sign-in return URLs', async ({ page, environment }) => {
  const user = await register(page, 'Route owner')
  await signIn(page, user)
  const space = await createSpace(page, 'Routed repository')
  const { id } = await (await page.request.get(`/api/namespaces/${space.account}/spaces/${space.slug}`)).json()
  const work = join(environment.root, 'route-seed')
  await environment.git(['clone', join(environment.root, 'data', id), work])
  const git = (args: string[]) => environment.git(['-C', work, ...args])
  const name = 'feature/docs%2Fnotes'
  const filename = 'literal %2F #.md'
  await writeFile(join(work, filename), '# Path fixture\n')
  await git(['add', '.'])
  await git(['commit', '-m', 'Path routing commit'])
  const commit = (await git(['rev-parse', 'HEAD'])).stdout.trim()
  await git(['push', 'origin', 'HEAD:main', 'HEAD:refs/heads/' + name])
  const branchPath = `${space.url}/branch/${encodeURIComponent(name)}`
  await page.goto(branchPath)
  await expect(page.getByLabel('Branch', { exact: true })).toHaveValue(name)
  await page.getByRole('list', { name: 'Repository files' }).getByRole('link').filter({ hasText: filename }).click()
  const filePath = `${branchPath}/at/${commit}/file/${encodeURIComponent(filename)}`
  await expect(page).toHaveURL(environment.webOrigin + filePath)
  await page.reload()
  await expect(page.getByLabel('File contents')).toContainText('Path fixture')
  await page.goto(`${space.url}/commit/${commit}`)
  await expect(page.getByRole('heading', { name: 'Path routing commit', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'File diff' })).toContainText('+# Path fixture')
  await page.goto(`${space.url}?ref=${encodeURIComponent(name)}`)
  await expect(page).toHaveURL(environment.webOrigin + branchPath)
  await page.goto(branchPath + '/unknown')
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await signOut(page, user)
  await page.goto(filePath)
  await expect(page.getByRole('heading', { name: 'Sign in to view this Space' })).toBeVisible()
  await page.getByRole('main').getByRole('link', { name: 'Sign in', exact: true }).click()
  await page.getByLabel('Email', { exact: true }).fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(user.password)
  await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(environment.webOrigin + filePath)
  await expect(page.getByLabel('File contents')).toContainText('Path fixture')
})
