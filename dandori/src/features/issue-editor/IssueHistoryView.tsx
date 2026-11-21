import type { Issue } from '../../db/types'
import { formatIssueNumber } from '../../lib/issueNumber'
import { formatMin } from '../timeline/timelineLogic'

export function IssueHistoryView({ issue, destination, hidden, onOpen, onClose }: { issue: Issue; destination?: Issue; hidden: boolean; onOpen: (id: string) => void; onClose: () => void }) {
  return (
      <div className={`${hidden ? 'hidden' : 'flex'} fixed inset-0 z-40 items-end bg-black/50`} onClick={onClose}>
        <section role="dialog" aria-modal="true" aria-label="持ち越し前の配置履歴" onClick={event => event.stopPropagation()} className="mx-auto flex max-h-[90%] w-full max-w-xl flex-col gap-3 overflow-y-auto rounded-t-2xl bg-surface p-4 pb-8">
          <h2 className="font-bold">{formatIssueNumber(issue.number)} · 配置履歴</h2>
          <p className="font-semibold">{issue.title}</p>
          <p className="text-sm">{issue.date} · {issue.calendarAllDay ? '終日' : issue.startMin === null ? '未配置' : `${formatMin(issue.startMin)}〜${formatMin(issue.startMin + issue.durationMin)}`}</p>
          <p className="text-sm text-muted">未完了 · {destination?.date ?? '後日'}へ持ち越し済み</p>
          <p className="text-xs text-muted">当日の記録を残すため、履歴の変更・削除・完了操作はできません。残タスク数には持ち越し先だけを数えます。</p>
          {issue.description && <p className="whitespace-pre-wrap break-words text-sm">{issue.description}</p>}
          {issue.labels.length > 0 && <p className="text-xs text-muted">ラベル：{issue.labels.join('、')}</p>}
          {destination ? <button type="button" className="min-h-11 rounded-lg bg-accent text-accent-text" onClick={() => onOpen(destination.id)}>持ち越し先を開く</button> : <p className="text-xs text-muted">持ち越し先は削除されています。</p>}
          <button type="button" className="min-h-11 rounded-lg border border-border" onClick={onClose}>閉じる</button>
        </section>
      </div>
  )
}
