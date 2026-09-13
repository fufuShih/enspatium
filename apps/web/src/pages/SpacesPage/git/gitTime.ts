export function gitRelativeTime(value: string, now = Date.now()) {
  const seconds = (new Date(value).getTime() - now) / 1000
  if (!Number.isFinite(seconds)) return 'Unknown date'
  if (Math.abs(seconds) < 60) return seconds > 0 ? 'in a moment' : 'just now'
  const units = [[31_536_000, 'year'], [2_592_000, 'month'], [86_400, 'day'], [3_600, 'hour'], [60, 'minute']] as const
  const [size, unit] = units.find(([size]) => Math.abs(seconds) >= size)!
  return new Intl.RelativeTimeFormat('en', { numeric: 'always' }).format(Math.trunc(seconds / size), unit)
}
