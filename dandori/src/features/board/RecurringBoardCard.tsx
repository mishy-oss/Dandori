import { useId, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale/ja'
import { Icon } from '../../app/Icon'
import type { Issue, RecurrenceRule, WorkflowStatus } from '../../db/types'
import { formatIssueNumber } from '../../lib/issueNumber'
import { formatMin } from '../timeline/timelineLogic'
import type { BoardIssueGroup } from './recurringGroups'
import { TaskRelations } from './TaskRelations'

interface Props {
  group: BoardIssueGroup
  relatedIssues?: Issue[]
  rule?: RecurrenceRule
  statuses: WorkflowStatus[]
  doneIds: Set<string>
  pulse: boolean
  onOpen: (issue: Issue) => void
  onToggleDone: (id: string) => Promise<void>
  onChangeStatus: (id: string, statusId: string) => Promise<void>
}

/** 各回の予定日と時刻を、人が読みやすい短い文字列にする。 */
function occurrenceLabel(issue: Issue): string {
  const date = issue.date ? format(parseISO(issue.date), 'M/d(E)', { locale: ja }) : '日付未設定'
  return issue.startMin === null ? date : `${date} ${formatMin(issue.startMin)}`
}

/** ルールの頻度と間隔から「毎日」「2週ごと」などの説明を作る。 */
function frequencyLabel(rule?: RecurrenceRule): string {
  if (!rule) return '繰り返し'
  const unit = { daily: '日', weekly: '週', monthly: 'か月' }[rule.frequency]
  const label = rule.interval === 1 ? { daily: '毎日', weekly: '毎週', monthly: '毎月' }[rule.frequency] : `${rule.interval}${unit}ごと`
  return rule.active ? label : `${label} · 停止済み`
}

/** 本文クリックで代表回を編集し、三角ボタンで繰り返し一覧を展開する。各回の編集・完了・ステータス変更も個別に受け付ける。 */
export function RecurringBoardCard({ group, relatedIssues = [], rule, statuses, doneIds, pulse, onOpen, onToggleDone, onChangeStatus }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const detailsId = useId()
  const doneCount = group.occurrences.filter(/* グループ内の完了した回数を数える。 */ (issue) => doneIds.has(issue.statusId)).length
  const allDone = doneCount === group.occurrences.length

  /** 保存が終わるまで追加操作を止め、各回の操作が重複して実行されないようにする。 */
  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    try { await action() } finally { setBusy(false) }
  }

  return (
    <section data-card-id={group.issue.id} data-no-drag aria-label={`${group.issue.title}の繰り返し`} className={`overflow-hidden rounded-2xl border border-border bg-surface ${pulse ? 'animate-pop' : ''}`}>
      <div className="flex items-stretch">
      <button type="button" aria-label={`${group.issue.title}を編集`}
        onClick={/* 通常カードと同様に、本文から次の未完了回の編集画面を開く。 */ () => onOpen(group.issue)}
        className="flex min-h-20 min-w-0 flex-1 items-center gap-3 rounded-xl p-4 pr-1 text-left">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent"><Icon name="timeline" className="size-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="mb-1 block text-[10px] font-medium text-muted">↻ {frequencyLabel(rule)} · {group.occurrences.length}回分</span>
          <span className="block truncate text-sm font-semibold">{group.issue.title}</span>
          <TaskRelations issue={group.issue} issues={relatedIssues} doneIds={doneIds} />
          <span className="mt-1 block text-[11px] text-muted">完了 {doneCount}/{group.occurrences.length}{!allDone && ` · 次の未完了 ${occurrenceLabel(group.issue)}`}</span>
        </span>
      </button>
      <button type="button" data-no-drag aria-expanded={expanded} aria-controls={detailsId}
        aria-label={`${group.issue.title}の繰り返し一覧を${expanded ? '閉じる' : '開く'}`}
        onClick={/* 三角とその周辺の専用ボタンだけで一覧を開閉し、編集画面は開かない。 */ () => setExpanded(!expanded)}
        className="flex min-h-20 w-12 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-surface-2">
        <span aria-hidden className={`text-xl transition-transform ${expanded ? 'rotate-180' : ''}`}>▾</span>
      </button>
      </div>
      <div className="mx-4 mb-3 h-1 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${doneCount / group.occurrences.length * 100}%` }} /></div>
      {!expanded && !allDone && <button type="button" disabled={busy} className="mx-4 mb-3 min-h-11 rounded-xl bg-surface-2 px-3 text-xs font-medium disabled:opacity-40"
        onClick={/* 全件ではなく、代表となる次の未完了回だけを完了にする。 */ () => void run(/* 次の1回の完了状態を切り替える。 */ () => onToggleDone(group.issue.id))}>次の1件を完了</button>}
      {allDone && !expanded && <p className="px-4 pb-4 text-xs text-muted">この月の予定はすべて完了しました</p>}
      <div id={detailsId} hidden={!expanded} className="border-t border-border">
        <p className="px-4 pt-3 text-[10px] text-muted">日付を押すと編集できます。完了やステータス変更は、その回だけに反映されます。</p>
        <ul className="divide-y divide-border px-2">
          {group.occurrences.map(/* 日付順に各回の編集と状態変更の操作を表示する。 */ (issue) => {
            const done = doneIds.has(issue.statusId)
            return <li key={issue.id} className="flex items-center gap-1 py-2">
              <button type="button" disabled={busy} aria-label={`${occurrenceLabel(issue)}の${issue.title}を${done ? '未完了に戻す' : '完了にする'}`} aria-pressed={done}
                className="flex size-11 shrink-0 items-center justify-center rounded-full disabled:opacity-40"
                onClick={/* 選択した回だけ完了状態を切り替える。 */ () => void run(/* 指定回の保存が終わるまで待つ。 */ () => onToggleDone(issue.id))}>
                <span className={`flex size-5 items-center justify-center rounded-full border ${done ? 'border-accent bg-accent text-accent-text' : 'border-muted'}`}>{done && <Icon name="check" className="size-3" />}</span>
              </button>
              <button type="button" className="min-h-11 min-w-0 flex-1 text-left" onClick={/* 選択した回の編集画面を開く。 */ () => onOpen(issue)}>
                <span className={`block text-xs font-medium ${done ? 'text-muted line-through' : ''}`}>{occurrenceLabel(issue)}</span>
                <span className="block truncate text-[10px] text-muted">{formatIssueNumber(issue.number)}{issue.title !== group.issue.title && ` · ${issue.title}`}</span>
                <TaskRelations issue={issue} issues={relatedIssues} doneIds={doneIds} />
              </button>
              <select aria-label={`${occurrenceLabel(issue)}のステータス`} value={issue.statusId} disabled={busy}
                className="min-h-11 max-w-[40%] rounded-lg border border-border bg-surface-2 px-2 text-[11px] disabled:opacity-40"
                onChange={/* この回のステータスだけ変更する。 */ (event) => { const statusId = event.target.value; void run(/* 選択されたステータスへの保存を待つ。 */ () => onChangeStatus(issue.id, statusId)) }}>
                {statuses.map(/* 既存ワークフローのステータスを選択肢にする。 */ (status) => <option key={status.id} value={status.id}>{status.name}</option>)}
              </select>
            </li>
          })}
        </ul>
      </div>
    </section>
  )
}
