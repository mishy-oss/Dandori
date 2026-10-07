import type { Issue, Sprint } from '../../db/types'
import { BacklogRow } from './BacklogRow'

const STATE_LABEL = { planned: '計画中', active: 'アクティブ', closed: '完了' } as const

export function SprintSection({
  sprint,
  issues,
  allCount,
  doneCount,
  estimateMin,
  filtered,
  doneIds,
  statusName,
  onOpen,
  onMove,
  onToggleDone,
  onStart,
  onComplete,
  onEdit,
  onDelete,
}: {
  sprint: Sprint
  issues: Issue[]
  allCount: number
  doneCount: number
  estimateMin: number
  filtered: boolean
  doneIds: Set<string>
  statusName: (id: string) => string
  onOpen: (issue: Issue) => void
  onMove: (issue: Issue) => void
  onToggleDone: (issue: Issue) => void
  onStart: () => void
  onComplete: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const badge =
    sprint.state === 'active'
      ? 'bg-accent text-accent-text'
      : sprint.state === 'closed'
        ? 'bg-surface-2 text-muted'
        : 'bg-surface-2'

  return (
    <section aria-label={sprint.name} className="flex flex-col gap-2 rounded-xl border border-border bg-bg p-3">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 truncate font-semibold">{sprint.name}</h2>
          <span className={`rounded-full px-2 py-0.5 text-xs ${badge}`}>{STATE_LABEL[sprint.state]}</span>
        </div>
        <p className="text-xs text-muted">
          {sprint.startDate} 〜 {sprint.endDate} · {allCount}件(完了 {doneCount})
          {estimateMin > 0 ? ` · 見積 ${estimateMin}分` : ''}
        </p>
        {sprint.goal && <p className="text-sm">🎯 {sprint.goal}</p>}
        {sprint.state !== 'closed' && (
          <div className="mt-1 flex flex-wrap gap-2">
            {sprint.state === 'planned' && (
              <button
                onClick={onStart}
                className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-text"
              >
                開始
              </button>
            )}
            {sprint.state === 'active' && (
              <button
                onClick={onComplete}
                className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-text"
              >
                完了
              </button>
            )}
            <button onClick={onEdit} className="min-h-11 rounded-lg border border-border px-4 text-sm">
              編集
            </button>
            {sprint.state === 'planned' && (
              <button
                onClick={onDelete}
                className="min-h-11 rounded-lg border border-red-500 px-4 text-sm text-red-500"
              >
                削除
              </button>
            )}
          </div>
        )}
      </header>

      {issues.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted">
          {filtered && allCount > 0
            ? '条件に一致するIssueはありません'
            : sprint.state === 'closed'
              ? 'Issueはありません'
              : 'Issueを追加してください(行を左スワイプ/長押し、または編集シートから)'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {issues.map((i) => (
            <li key={i.id}>
              <BacklogRow
                issue={i}
                done={doneIds.has(i.statusId)}
                statusName={statusName(i.statusId)}
                onOpen={() => onOpen(i)}
                onMove={() => onMove(i)}
                onToggleDone={() => onToggleDone(i)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
