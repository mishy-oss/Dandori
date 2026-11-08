import type { Issue } from '../../db/types'
import { formatIssueNumber } from '../../lib/issueNumber'

/** 月をまたいだ親子も含め、親の名前と直接の子の完了件数を表示する。 */
export function TaskRelations({ issue, issues, doneIds }: { issue: Issue; issues: Issue[]; doneIds: Set<string> }) {
  const parent = issues.find((item) => item.id === issue.parentId && item.deletedAt === null)
  const children = issues.filter((item) => item.parentId === issue.id && item.deletedAt === null)
  return <>
    {parent && <span className="block truncate text-xs text-muted">親: {formatIssueNumber(parent.number)} · {parent.title}</span>}
    {children.length > 0 && <span className="block text-xs text-muted">子タスク {children.filter((child) => doneIds.has(child.statusId)).length}/{children.length} 完了</span>}
  </>
}
