import type { SpaceType } from '../../db/space.types.js'

export type CheckOptions = { spaceId?: string; deep?: boolean }
export type CheckIssue = {
  severity: 'info' | 'warning' | 'error'
  code: string
  message: string
  spaceId?: string
  objectId?: string
  versionId?: string
  key?: string
  path?: string
  detail?: string
}
export type CheckedSpace = {
  id: string
  namespace: string
  slug: string
  type: SpaceType
  objects: number
  versions: number
  filesChecked: number
  hashesChecked: number
  // Decimal strings avoid losing precision when summing many versions.
  versionBytes: string
}
export type StorageCheckReport = {
  startedAt: string
  finishedAt: string
  mode: 'basic' | 'deep'
  dataRoot: string
  scope: string
  consistency: 'service-writes-paused'
  complete: boolean
  status: 'ok' | 'issues' | 'incomplete'
  spaces: CheckedSpace[]
  issues: CheckIssue[]
}
export type IssueReporter = (issue: CheckIssue, incomplete?: boolean) => void

export function finishReport(report: StorageCheckReport): StorageCheckReport {
  report.finishedAt = new Date().toISOString()
  report.status = !report.complete
    ? 'incomplete'
    : report.issues.some((i) => i.severity !== 'info')
      ? 'issues'
      : 'ok'
  report.issues.sort((a, b) =>
    [a.spaceId, a.path, a.code, a.versionId]
      .join('\0')
      .localeCompare([b.spaceId, b.path, b.code, b.versionId].join('\0')),
  )
  return report
}
