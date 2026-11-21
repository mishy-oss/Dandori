import type { Issue } from '../../db/types'
import { currentWork } from '../../lib/carryover'
import { formatIssueNumber } from '../../lib/issueNumber'

function searchText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()
}

export function descendantTaskIds(issues: Issue[], issueId?: string): Set<string> {
  const found = new Set<string>()
  if (!issueId) return found
  const children = new Map<string, string[]>()
  for (const issue of issues) {
    if (!issue.parentId) continue
    const family = children.get(issue.parentId) ?? []
    family.push(issue.id)
    children.set(issue.parentId, family)
  }
  const seen = new Set([issueId])
  const pending = [issueId]
  while (pending.length) {
    for (const child of children.get(pending.pop()!) ?? []) {
      if (seen.has(child)) continue
      seen.add(child)
      found.add(child)
      pending.push(child)
    }
  }
  return found
}

export function parentTaskOptions(issues: Issue[], projectId: string, issueId?: string): Issue[] {
  const projectIssues = issues.filter(issue => issue.projectId === projectId)
  // 画面でも自分と子孫を除き、親子関係を循環させる選択を防ぐ。
  const excluded = descendantTaskIds(projectIssues, issueId)
  if (issueId) excluded.add(issueId)
  return currentWork(projectIssues).filter(issue => !excluded.has(issue.id))
}

export function searchParentTasks(options: Issue[], input: string): Issue[] {
  const query = searchText(input)
  const terms = query.split(' ').filter(Boolean)
  const relevance = (issue: Issue) => {
    if (!query) return 0
    if (query === formatIssueNumber(issue.number) || query === String(issue.number)) return 0
    const title = searchText(issue.title)
    return title === query ? 1 : title.startsWith(query) ? 2 : 3
  }
  return options.filter(issue => {
    const text = `${formatIssueNumber(issue.number)} ${searchText(issue.title)}`
    return terms.every(term => text.includes(term))
  }).sort((a, b) => relevance(a) - relevance(b) || b.updatedAt - a.updatedAt || b.number - a.number || a.id.localeCompare(b.id))
}
