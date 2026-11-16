import { useState } from 'react'
import { Sheet } from '../../app/Sheet'
import type { Issue } from '../../db/types'
import { issueMonth, isValidMonth } from '../../lib/month'
import { formatIssueNumber } from '../../lib/issueNumber'
import { useDataStore } from '../../store/data'

export function MoveSheet({ issue, onClose }: { issue: Issue; onClose: () => void }) {
  const assign = useDataStore((state) => state.assignIssueToMonth)
  const [month, setMonth] = useState(issueMonth(issue))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try { await assign(issue.id, month); onClose() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }
  return <Sheet label="対象月を変更" onClose={onClose}>
    <h2 className="text-lg font-bold">対象月を変更</h2>
    <p className="text-sm text-muted">{formatIssueNumber(issue.number)} · {issue.title}</p>
    <label className="text-sm text-muted">対象月<input aria-label="変更先の対象月" type="month" className="mt-1 block min-h-11 w-full rounded-xl border border-border bg-surface-2 px-3" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
    <p className="text-xs text-muted">別の月に移す場合、元の時刻配置は解除します。過去月に残る未完了タスクは今月へ自動で繰り越します。</p>
    {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
    <div className="flex gap-2"><button type="button" className="min-h-11 flex-1 rounded-xl border border-border text-sm" onClick={onClose}>キャンセル</button><button type="button" disabled={busy || !isValidMonth(month)} className="min-h-11 flex-1 rounded-xl bg-accent text-sm text-accent-text disabled:opacity-40" onClick={() => void save()}>変更する</button></div>
  </Sheet>
}
