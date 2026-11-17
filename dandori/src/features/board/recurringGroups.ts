import type { Issue } from '../../db/types'
import { compareRank } from '../../lib/rank'

export interface BoardIssueGroup {
  key: string
  issue: Issue
  occurrences: Issue[]
  recurring: boolean
}

export function compareOccurrences(a: Issue, b: Issue): number {
  return (a.date ?? '9999-12-31').localeCompare(b.date ?? '9999-12-31') ||
    (a.startMin ?? 1440) - (b.startMin ?? 1440) || a.number - b.number
}

/* 別の月や旧スプリントの予定が同じカードへ混ざらないよう、所属もグループのキーに含める。 */
export function groupBoardIssues(issues: Issue[], doneIds: Set<string>): BoardIssueGroup[] {
  const groups = new Map<string, BoardIssueGroup>()
  for (const issue of issues) {
    if (issue.deletedAt !== null) continue
    const key = JSON.stringify(issue.recurrenceId || issue.calendarSeriesId
      ? [issue.recurrenceId ? 'recurrence' : 'google-recurrence', issue.projectId, issue.planningMonth ?? issue.sprintId, issue.recurrenceId ?? issue.calendarSeriesId]
      : ['issue', issue.id])
    const group = groups.get(key)
    if (group) group.occurrences.push(issue)
    else groups.set(key, { key, issue, occurrences: [issue], recurring: issue.recurrenceId !== null || !!issue.calendarSeriesId })
  }
  for (const group of groups.values()) {
    group.occurrences.sort(compareOccurrences)
    group.issue = group.occurrences.find((issue) => !doneIds.has(issue.statusId)) ?? group.occurrences[0]
  }
  return [...groups.values()].sort((a, b) => compareRank(a.issue, b.issue))
}

/* 1枚のカードに複数回が隠れるため、表示上の挿入位置をそのまま保存には使えない。 */
export function groupedDropIndex(issues: Issue[], doneIds: Set<string>, movingId: string, statusId: string, index: number): number {
  const remaining = issues.filter((issue) => issue.id !== movingId && issue.deletedAt === null)
  const column = remaining.filter((issue) => issue.statusId === statusId).sort(compareRank)
  const visible = groupBoardIssues(remaining, doneIds).filter((group) => group.issue.statusId === statusId)
  const anchor = visible[Math.max(0, index)]
  if (!anchor) return column.length
  return column.findIndex((issue) => issue.id === anchor.issue.id)
}
