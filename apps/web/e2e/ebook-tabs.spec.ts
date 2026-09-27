import { test, expect } from './fixtures.js'
import { createSpace, register, signIn } from './helpers.js'
import { pdfFixture } from './ebook-fixtures.js'

test('PDF floating tab list restores independent positions and zoom on desktop and mobile', async ({ page, environment }, testInfo) => {
  test.setTimeout(90_000)
  const user = await register(page, 'Tabbed reader')
  await signIn(page, user)
  const space = await createSpace(page, 'Reference books', undefined, 'ebook')
  const base = `/api/namespaces/${space.account}/spaces/${space.slug}`
  const { id } = await (await page.request.get(base)).json() as { id: string }
  for (const name of ['Reference.pdf', 'Another.pdf']) {
    expect((await page.request.put(base + '/objects/' + name, {
      data: pdfFixture(20, true), headers: { 'content-type': 'application/pdf' },
    })).status()).toBe(201)
  }
  await page.goto(`${environment.webOrigin}/app/ebook/${id}/`)
  await page.getByRole('link', { name: 'Read Reference.pdf', exact: true }).click()
  const reader = page.getByRole('region', { name: 'PDF pages' })
  const trigger = page.getByRole('button', { name: 'Reading tabs', exact: true })
  const popup = page.getByRole('dialog', { name: 'Reading tabs', exact: true })
  const tabs = popup.getByRole('list', { name: 'PDF reading tabs' })
  const tab = (id: number) => tabs.getByRole('button', { name: new RegExp(`^Reading tab ${id},`) })
  const open = async () => {
    if (!await popup.isVisible()) await trigger.click()
    await expect(popup).toBeVisible()
  }
  const dismiss = async () => {
    await page.keyboard.press('Escape')
    await expect(popup).toBeHidden()
    await expect(trigger).toBeFocused()
  }
  const add = async () => {
    await open()
    await popup.getByRole('button', { name: 'New reading tab', exact: true }).click()
    await expect(popup).toBeHidden()
  }
  const select = async (id: number) => {
    await open()
    await tab(id).click()
    await expect(popup).toBeHidden()
  }
  const position = () => reader.evaluate(root => ({ top: root.scrollTop, left: root.scrollLeft }))
  const move = async (number: number, offset: number, left = 0) => {
    await reader.evaluate((root, target) => {
      const element = root.querySelector<HTMLElement>(`[data-pdf-page="${target.number}"]`)!
      root.scrollTop += element.getBoundingClientRect().top - root.getBoundingClientRect().top + target.offset
      root.scrollLeft = target.left
    }, { number, offset, left })
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  }
  await expect(reader.locator('[data-pdf-page]')).toHaveCount(20)
  await expect(popup).toBeHidden()
  await expect(page.locator('header').getByRole('button', { name: 'Reading tabs', exact: true })).toHaveCount(0)
  const readerBounds = (await reader.boundingBox())!
  const triggerBounds = (await trigger.boundingBox())!
  expect(triggerBounds.x - readerBounds.x).toBeCloseTo(12, 0)
  expect(triggerBounds.y - readerBounds.y).toBeCloseTo(12, 0)
  await move(3, 275)
  const first = await position()
  await open()
  await expect(tabs.getByRole('listitem')).toHaveCount(1)
  await expect(tab(1).getByText('Tab 1', { exact: true })).toBeVisible()
  await expect(tab(1).getByText('Page 3 of 20', { exact: true })).toBeVisible()
  await expect(tab(1)).toHaveAttribute('aria-current', 'true')
  await expect.poll(async () => Math.abs((await position()).top - first.top)).toBeLessThan(2)
  await dismiss()
  await add()
  await expect.poll(async () => Math.abs((await position()).top - first.top)).toBeLessThan(2)
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect(page.getByRole('button', { name: 'Auto zoom' })).toHaveText('125%')
  await move(12, 360, 75)
  const second = await position()
  expect(second.left).toBeGreaterThan(0)
  await open()
  await expect(tab(2).getByText('Page 12 of 20', { exact: true })).toBeVisible()
  await expect(tab(2)).toHaveAttribute('aria-current', 'true')
  await page.screenshot({ path: testInfo.outputPath('ebook-reading-tabs.png'), fullPage: true, animations: 'disabled' })
  await select(1)
  await expect(page.getByRole('button', { name: 'Auto zoom' })).toHaveText('Auto')
  await expect.poll(async () => Math.abs((await position()).top - first.top)).toBeLessThan(2)
  await select(2)
  await expect(page.getByRole('button', { name: 'Auto zoom' })).toHaveText('125%')
  await expect.poll(async () => Math.abs((await position()).top - second.top)).toBeLessThan(2)
  await expect.poll(async () => Math.abs((await position()).left - second.left)).toBeLessThan(2)
  await expect(reader).toHaveCount(1)
  await expect.poll(() => reader.locator('canvas').count()).toBeLessThan(6)
  await add()
  await open()
  await popup.getByRole('button', { name: 'Close reading tab 2', exact: true }).click()
  await expect(tab(3)).toHaveAttribute('aria-current', 'true')
  await expect.poll(async () => Math.abs((await position()).top - second.top)).toBeLessThan(2)
  await popup.getByRole('button', { name: 'Close reading tab 3', exact: true }).click()
  await expect(tab(1)).toHaveAttribute('aria-current', 'true')
  await expect.poll(async () => Math.abs((await position()).top - first.top)).toBeLessThan(2)
  await expect(popup.getByRole('button', { name: 'Close reading tab 1', exact: true })).toHaveCount(0)
  await add()
  // Arrow keys move through the list; Enter selects, and Escape returns to the FAB.
  await open()
  await expect(tab(4)).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(tab(1)).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(popup).toBeHidden()
  await open()
  await expect(tab(1)).toHaveAttribute('aria-current', 'true')
  await page.keyboard.press('ArrowDown')
  await expect(tab(4)).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(popup).toBeHidden()
  await open()
  await reader.click({ position: { x: readerBounds.width - 30, y: 500 } })
  await expect(popup).toBeHidden()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('navigation', { name: 'PDF navigation' })).toBeHidden()
  await move(7, 100)
  const mobile = await position()
  for (let index = 0; index < 8; index++) await add()
  await expect.poll(async () => Math.abs((await position()).top - mobile.top)).toBeLessThan(2)
  await open()
  await expect(tabs.getByRole('listitem')).toHaveCount(10)
  await expect(tab(12)).toHaveAttribute('aria-current', 'true')
  await expect(tab(12)).toBeInViewport()
  expect(await tabs.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
  await expect(popup.getByRole('button', { name: 'New reading tab', exact: true })).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('ebook-reading-tabs-mobile.png'), fullPage: true, animations: 'disabled' })
  await dismiss()
  await page.setViewportSize({ width: 320, height: 568 })
  const fab = (await trigger.boundingBox())!
  const controls = (await page.getByRole('toolbar', { name: 'Reading controls' }).boundingBox())!
  expect(fab.x + fab.width).toBeLessThan(controls.x)
  await open()
  const popupBounds = (await popup.boundingBox())!
  expect(popupBounds.x).toBeGreaterThanOrEqual(0)
  expect(popupBounds.x + popupBounds.width).toBeLessThanOrEqual(320)
  expect(popupBounds.y + popupBounds.height).toBeLessThanOrEqual(568)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true)
  await dismiss()
  await page.getByRole('link', { name: 'Back to library', exact: true }).click()
  await page.getByRole('link', { name: 'Read Another.pdf', exact: true }).click()
  await open()
  await expect(tabs.getByRole('listitem')).toHaveCount(1)
  await expect(tab(1).getByText('Page 1 of 20', { exact: true })).toBeVisible()
  await dismiss()
  await expect(page.getByRole('button', { name: 'Auto zoom' })).toHaveText('Auto')
})
