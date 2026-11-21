import type { Issue } from '../../db/types'
import { currentWork } from '../../lib/carryover'
import { issueMonth } from '../../lib/month'
import { matchesFilter, type IssueFilter } from '../backlog/filters'
import { groupBoardIssues } from './recurringGroups'

export function selectBoardGroups(issues: Issue[], doneIds: Set<string>, month: string, allMonths: boolean, filter: IssueFilter) {
  const scoped = currentWork(issues).filter(issue => allMonths || issueMonth(issue) === month)
  // 各回を先に除くと、検索結果の進捗や次回が実際のシリーズと食い違う。
  return groupBoardIssues(scoped, doneIds).filter(group => group.occurrences.some(issue => matchesFilter(issue, filter)))
}

export function statusMoveScope(issues: Issue[], id: string, statusId: string) {
  const moving = issues.find(issue => issue.id === id)
  if (!moving) return null
  const month = issueMonth(moving)
  return {
    month,
    index: currentWork(issues).filter(issue => issue.id !== id && issue.projectId === moving.projectId && issueMonth(issue) === month && issue.statusId === statusId).length,
  }
}
