import type { Issue } from '../db/types'

export function currentWork(issues: Issue[]): Issue[] {
  return issues.filter(issue => issue.deletedAt === null && !issue.carryoverToId)
}

export function carryoverHistory(issue: Issue, issues: Issue[]): Issue[] {
  const root = issue.carryoverRootId ?? issue.id
  return issues.filter(item => item.deletedAt === null && item.carryoverToId && (item.carryoverRootId ?? item.id) === root)
    .sort((a, b) => (a.carryoverSequence ?? 0) - (b.carryoverSequence ?? 0))
}
