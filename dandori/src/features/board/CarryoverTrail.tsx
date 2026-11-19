import type { Issue } from '../../db/types'
import { carryoverHistory } from '../../lib/carryover'
import { formatIssueNumber } from '../../lib/issueNumber'

export function CarryoverTrail({ issue, issues, onOpen }: { issue: Issue; issues: Issue[]; onOpen: (issue: Issue) => void }) {
  const history = carryoverHistory(issue, issues)
  if (!history.length) return null
  return <details data-no-drag className="rounded-xl border border-border bg-surface px-3 text-xs">
    <summary className="min-h-11 cursor-pointer py-3 text-muted">持ち越し履歴（{history.length}件）</summary>
    <ul>{history.map(item => <li key={item.id}><button type="button" className="min-h-11 w-full text-left" onClick={() => onOpen(item)}>{item.date} · {formatIssueNumber(item.number)} · 未完了・持ち越し済み</button></li>)}</ul>
  </details>
}
