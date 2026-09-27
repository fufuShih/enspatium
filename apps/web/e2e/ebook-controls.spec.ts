import { test, expect } from './fixtures.js'
import { createSpace, register, signIn } from './helpers.js'
import { pdfFixture } from './ebook-fixtures.js'

test('PDF page input validates navigation and follows scrolling and reading tabs', async ({ page, environment }, testInfo) => {
  const user = await register(page, 'Page navigation reader')
  await signIn(page, user)
  const space = await createSpace(page, 'Page navigation', undefined, 'ebook')
  const base = `/api/namespaces/${space.account}/spaces/${space.slug}`
  const { id } = await (await page.request.get(base)).json() as { id: string }
  expect((await page.request.put(base + '/objects/Reference.pdf', {
    data: pdfFixture(20), headers: { 'content-type': 'application/pdf' },
  })).status()).toBe(201)
  await page.goto(`${environment.webOrigin}/app/ebook/${id}/`)
  await page.getByRole('link', { name: 'Read Reference.pdf', exact: true }).click()
  const reader = page.getByRole('region', { name: 'PDF pages' })
  const controls = page.getByRole('toolbar', { name: 'Reading controls' })
  const input = controls.getByRole('textbox', { name: 'Page number', exact: true })
  const jump = async (number: number) => {
    await input.fill(String(number))
    await input.press('Enter')
    await expect(input).toHaveValue(String(number))
    await expect(page.getByRole('img', { name: `PDF page ${number}`, exact: true })).toBeVisible()
    await expect(reader.locator('[aria-busy="true"]')).toHaveCount(0)
  }
  await expect(input).toBeEnabled()
  await jump(7)
  const savedTop = await reader.evaluate(element => element.scrollTop)
  for (const invalid of ['', '0', '21', '-1', '1.5', '1e1', 'abc']) {
    await input.fill(invalid)
    await input.press('Enter')
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    await expect(controls.getByRole('alert')).toHaveText('Enter a whole page number from 1 to 20.')
    expect(await reader.evaluate(element => element.scrollTop)).toBe(savedTop)
  }
  await input.press('Escape')
  await expect(input).toHaveValue('7')
  await expect(controls.getByRole('alert')).toHaveCount(0)
  await input.fill('5')
  await page.getByRole('button', { name: 'Auto zoom' }).click()
  await expect(input).toHaveValue('7')
  expect(await reader.evaluate(element => element.scrollTop)).toBe(savedTop)
  await jump(20)
  await jump(1)
  // Scrolling updates the field, but never overwrites an unfinished edit.
  await reader.evaluate(root => {
    const target = root.querySelector<HTMLElement>('[data-pdf-page="3"]')!
    root.scrollTop += target.getBoundingClientRect().top - root.getBoundingClientRect().top + 150
  })
  await expect(input).toHaveValue('3')
  await input.fill('9')
  await reader.evaluate(root => {
    const target = root.querySelector<HTMLElement>('[data-pdf-page="4"]')!
    root.scrollTop += target.getBoundingClientRect().top - root.getBoundingClientRect().top - 12
  })
  await expect(input).toHaveValue('9')
  await input.press('Escape')
  await expect(input).toHaveValue('4')
  const trigger = page.getByRole('button', { name: 'Reading tabs', exact: true })
  const popup = page.getByRole('dialog', { name: 'Reading tabs', exact: true })
  await trigger.click()
  await popup.getByRole('button', { name: 'New reading tab', exact: true }).click()
  await expect(popup).toBeHidden()
  await jump(14)
  await trigger.click()
  await popup.getByRole('button', { name: 'Reading tab 1, page 4', exact: true }).click()
  await expect(input).toHaveValue('4')
  await trigger.click()
  await popup.getByRole('button', { name: 'Reading tab 2, page 14', exact: true }).click()
  await expect(input).toHaveValue('14')
  await page.getByRole('button', { name: 'Zoom out' }).click()
  await page.getByRole('button', { name: 'Zoom out' }).click()
  await expect(page.getByRole('button', { name: 'Auto zoom' })).toHaveText('50%')
  await jump(8)
  await page.getByRole('button', { name: 'Auto zoom' }).click()
  await jump(6)
  await page.screenshot({ path: testInfo.outputPath('ebook-page-input.png'), fullPage: true, animations: 'disabled' })
  await page.setViewportSize({ width: 320, height: 568 })
  await expect(page.getByRole('navigation', { name: 'PDF navigation' })).toBeHidden()
  await jump(19)
  const fab = (await trigger.boundingBox())!
  const toolbar = (await controls.boundingBox())!
  expect(fab.x + fab.width).toBeLessThan(toolbar.x)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('ebook-page-input-mobile.png'), fullPage: true, animations: 'disabled' })
})
