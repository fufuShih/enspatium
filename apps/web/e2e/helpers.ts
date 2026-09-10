import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { expect } from './fixtures.js'

export type TestUser = { name: string; email: string; password: string }

export async function register(page: Page, name: string): Promise<TestUser> {
  const user = { name, email: randomUUID() + '@example.com', password: 'Browser-' + randomUUID() }
  await page.goto('/register')
  await page.getByLabel('Name', { exact: true }).fill(user.name)
  await page.getByLabel('Email', { exact: true }).fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByText('Account created. Sign in to continue.', { exact: true })).toBeVisible()
  return user
}

export async function signIn(page: Page, user: TestUser) {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(user.password)
  await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('button', { name: 'User menu for ' + user.name, exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/u-[a-f0-9]+$/)
}

export async function signOut(page: Page, user: TestUser) {
  await page.getByRole('button', { name: 'User menu for ' + user.name, exact: true }).click()
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Create menu', exact: true })).toHaveCount(0)
  await expect(page).toHaveURL(new URL('/', page.url()).href)
}

export async function createSpace(page: Page, name: string, organization?: string, type: 'git' | 'object' | 'media' = 'git') {
  await page.getByRole('button', { name: 'Create menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Create Space', exact: true }).click()
  if (organization) await page.getByLabel('Owner', { exact: true }).selectOption(organization)
  await page.getByLabel('Type', { exact: true }).selectOption(type)
  await page.getByLabel('Name', { exact: true }).fill(name)
  const account = await page.getByLabel('Owner', { exact: true }).inputValue()
  const slug = await page.getByLabel('URL name', { exact: true }).inputValue()
  await page.getByRole('button', { name: 'Create Space', exact: true }).click()
  const url = `/${account}/${slug}`
  await expect(page).toHaveURL(new RegExp(url + '$'))
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  return { account, slug, url }
}

export async function openSettings(page: Page) {
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Space settings', exact: true })).toBeVisible()
}
