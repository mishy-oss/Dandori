import type { Issue, IssueType, Priority } from '../../db/types'
import { formatIssueNumber } from '../../lib/issueNumber'

export interface IssueFilter {
  query: string
  priority: Priority | 'all'
  type: IssueType | 'all'
}

export const EMPTY_FILTER: IssueFilter = { query: '', priority: 'all', type: 'all' }

export function isFilterActive(f: IssueFilter): boolean {
  return f.query.trim() !== '' || f.priority !== 'all' || f.type !== 'all'
}

// 単純フィルタのみ(JQL風検索は対象外): タイトル・番号(#12)・ラベルの部分一致 + 優先度 + 種別
export function matchesFilter(issue: Issue, f: IssueFilter): boolean {
  if (f.priority !== 'all' && issue.priority !== f.priority) return false
  if (f.type !== 'all' && issue.type !== f.type) return false
  const q = f.query.trim().toLowerCase()
  if (!q) return true
  const haystack = [issue.title, formatIssueNumber(issue.number), ...issue.labels].join('\n').toLowerCase()
  return haystack.includes(q)
}
