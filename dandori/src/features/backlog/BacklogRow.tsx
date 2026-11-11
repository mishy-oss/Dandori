import { DoneCheckButton } from '../../app/DoneCheckButton'
import type { Issue, Priority } from '../../db/types'
import { PRIORITY_LABELS } from '../../db/types'
import { formatIssueNumber } from '../../lib/issueNumber'
import { useRowGestures } from './useRowGestures'

const PRIORITY_COLOR: Record<Priority, string> = {
  urgent: '#ef4444',
  highest: '#e85d75',
  high: '#f97316',
  medium: '#38bdf8',
  low: '#94a3b8',
}

/** Issueの番号・優先度・親子関係・完了状態を行として表示し、タップで編集、スワイプや長押しで移動操作を受け付ける。 */
export function BacklogRow({
  issue,
  done,
  statusName,
  parentIssue,
  childCount = 0,
  childDoneCount = 0,
  onOpen,
  onMove,
  onToggleDone,
}: {
  issue: Issue
  done: boolean
  statusName: string
  parentIssue?: Issue
  childCount?: number
  childDoneCount?: number
  onOpen: () => void
  onMove: () => void
  onToggleDone: () => void
}) {
  const { dx, swiping, onPointerDown, shouldSuppressClick } = useRowGestures(onMove)

  return (
    <div className="relative overflow-hidden rounded-xl">
      {dx !== 0 && (
        <div
          aria-hidden
          className="absolute inset-0 flex items-center justify-end bg-accent/20 px-4 text-sm font-semibold text-accent"
        >
          対象月を変更 →
        </div>
      )}
      <div
        role="button"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onContextMenu={/* 長押しや右クリックによる標準メニューを抑止し、ジェスチャー操作を続けられるようにする。 */ (e) => e.preventDefault()}
        onClick={/* 直前にジェスチャー操作をしていない場合だけ、対象Issueの編集画面を開く。 */ () => {
          if (!shouldSuppressClick()) onOpen()
        }}
        onKeyDown={/* Enterまたはスペースで対象Issueを開き、キーボードからも編集できるようにする。 */ (e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            onOpen()
          }
        }}
        className="relative flex min-h-14 touch-pan-y select-none items-center gap-1 rounded-xl border border-border bg-surface py-1 pl-1 pr-3 text-left [-webkit-touch-callout:none]"
        style={{
          borderLeft: `4px solid ${PRIORITY_COLOR[issue.priority]}`,
          transform: dx ? `translateX(${dx}px)` : undefined,
          transition: swiping ? 'none' : 'transform 160ms ease-out',
        }}
      >
        <DoneCheckButton done={done} onToggle={onToggleDone} />
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <span className="text-xs text-muted">
            {formatIssueNumber(issue.number)} · {issue.type} · {PRIORITY_LABELS[issue.priority]}
            {issue.recurrenceId ? ' · ↻ 繰り返し' : ''}
            {issue.estimateMin ? ` · ${issue.estimateMin} 分` : ''}
          </span>
          <span className={done ? 'line-through opacity-60' : ''}>{issue.title}</span>
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">{statusName}</span>
          {parentIssue && (
            <span className="max-w-full truncate text-xs text-muted">
              親: {parentIssue.type === 'epic' ? 'Epic' : parentIssue.type} · {formatIssueNumber(parentIssue.number)} · {parentIssue.title}
            </span>
          )}
          {childCount > 0 && (
            <span className="text-xs text-muted">子タスク {childDoneCount}/{childCount} 完了</span>
          )}
        </div>
      </div>
    </div>
  )
}
