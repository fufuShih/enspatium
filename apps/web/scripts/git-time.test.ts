import { expect, test } from 'vitest'
import { gitRelativeTime } from '../src/pages/SpacesPage/git/gitTime'

test('commit times use compact relative labels including future-dated commits', () => {
  const now = Date.parse('2026-09-13T12:00:00Z')
  expect(gitRelativeTime('2026-09-13T11:59:40Z', now)).toBe('just now')
  expect(gitRelativeTime('2026-09-13T11:58:00Z', now)).toBe('2 minutes ago')
  expect(gitRelativeTime('2026-09-11T12:00:00Z', now)).toBe('2 days ago')
  expect(gitRelativeTime('2026-09-13T14:00:00Z', now)).toBe('in 2 hours')
})
