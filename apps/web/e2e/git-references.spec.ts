import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { GetSpace200, ListGitSpaceReferences200 } from '../src/api/generated/api.schemas.js'
import { test, expect } from './fixtures.js'
import { createSpace, register, signIn } from './helpers.js'

test('old reference pages redirect to files and branch/tag selectors remain available', async ({ page, environment, request }) => {
  const user = await register(page, 'Reference owner')
  await signIn(page, user)
  const space = await createSpace(page, 'References repository')
  const base = `/api/namespaces/${space.account}/spaces/${space.slug}`
  const metadata = await (await page.request.get(base)).json() as GetSpace200
  await page.goto(space.url + '?view=refs')
  await expect(page.getByRole('heading', { name: 'Push your first commit', exact: true })).toBeVisible()
  const work = join(environment.root, 'refs-seed')
  await environment.git(['clone', join(environment.root, 'data', metadata.id), work])
  const git = (args: string[]) => environment.git(['-C', work, ...args])
  await writeFile(join(work, 'README.md'), '# Reference release\n')
  await git(['add', '.']); await git(['commit', '-m', 'Release commit'])
  const release = (await git(['rev-parse', 'HEAD'])).stdout.trim()
  const committedAt = (await git(['show', '-s', '--format=%cI'])).stdout.trim()
  await git(['tag', '-a', 'release/首版', '-m', 'First release'])
  await git(['tag', '-a', 'nested', 'release/首版', '-m', 'Nested release'])
  // Non-commit tags are intentionally not browsable as repository versions.
  const tree = (await git(['rev-parse', 'HEAD^{tree}'])).stdout.trim()
  await git(['tag', 'tree-only', tree])
  await writeFile(join(work, 'README.md'), '# Development\n')
  await git(['add', '.']); await git(['commit', '-m', 'Development commit'])
  const current = (await git(['rev-parse', 'HEAD'])).stdout.trim()
  const topics = Array.from({ length: 31 }, (_, i) => `topic/${String(i).padStart(2, '0')}`)
  await git(['push', 'origin', 'HEAD:main', 'HEAD:refs/heads/release/首版', ...topics.map(name => 'HEAD:refs/heads/' + name), '--tags'])
  expect((await request.get(base + '/git/refs?type=branch')).status()).toBe(401)
  expect((await page.request.get(base + '/git/refs?type=invalid')).status()).toBe(400)
  expect((await page.request.get(base + '/git/refs?type=branch&limit=101')).status()).toBe(400)
  const tags = await (await page.request.get(base + '/git/refs?type=tag')).json() as ListGitSpaceReferences200
  expect(tags.total).toBe(2)
  for (const tag of tags.items) expect(tag.commit).toMatchObject({ id: release, message: 'Release commit', committedAt })
  const branches = await (await page.request.get(base + '/git/refs?type=branch&limit=2&search=TOPIC')).json() as ListGitSpaceReferences200
  expect(branches.total).toBe(31); expect(branches.hasMore).toBe(true)
  expect(branches.items.map(ref => ref.name)).toEqual(['topic/00', 'topic/01'])
  expect(branches.items[0]!.commit.id).toBe(current)
  await page.goto(space.url + '/branches?search=old&offset=30')
  await expect(page).toHaveURL(environment.webOrigin + space.url)
  await expect(page.getByRole('heading', { name: 'Development', exact: true })).toBeVisible()
  const views = page.getByRole('navigation', { name: 'Repository views' })
  await expect(views.getByRole('link')).toHaveText(['Files', 'Commits', 'Compare'])
  await expect(page.getByRole('region', { name: 'Reference list', exact: true })).toHaveCount(0)
  await page.goto(space.url + '/tags')
  await expect(page).toHaveURL(environment.webOrigin + space.url + '/tag')
  await expect(page.getByRole('heading', { name: 'Reference release', exact: true })).toBeVisible()
  await page.getByLabel('Tag', { exact: true }).selectOption('release/首版')
  await expect(page.getByRole('heading', { name: 'Reference release', exact: true })).toBeVisible()
  await page.getByLabel('Reference type', { exact: true }).selectOption('branch')
  await page.getByLabel('Branch', { exact: true }).selectOption('topic/30')
  await expect(page.getByRole('heading', { name: 'Development', exact: true })).toBeVisible()
  await page.reload()
  await expect(views.getByRole('link')).toHaveText(['Files', 'Commits', 'Compare'])
})
