import { DoneCheckButton } from '../../app/DoneCheckButton'
import type { Issue, Priority } from '../../db/types'
import { formatIssueNumber } from '../../lib/issueNumber'
import { useRowGestures } from './useRowGestures'

const PRIORITY_COLOR: Record<Priority, string> = {
  urgent: '#ef4444',
  high: '#f97316',
  medium: '#38bdf8',
  low: '#94a3b8',
}

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
          スプリントへ移動 →
        </div>
      )}
      <div
        role="button"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          if (!shouldSuppressClick()) onOpen()
        }}
        onKeyDown={(e) => {
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
            {formatIssueNumber(issue.number)} · {issue.type} · {issue.priority}
            {issue.estimateMin ? ` · ${issue.estimateMin}分` : ''}
          </span>
          <span className={done ? 'line-through opacity-60' : ''}>{issue.title}</span>
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">{statusName}</span>
          {parentIssue && (
            <span className="max-w-full truncate text-xs text-muted">
              親: {parentIssue.type === 'epic' ? 'Epic' : parentIssue.type} · {formatIssueNumber(parentIssue.number)} · {parentIssue.title}
            </span>
          )}
          {childCount > 0 && (
            <span className="text-xs text-muted">子Issue {childDoneCount}/{childCount} 完了</span>
          )}
        </div>
      </div>
    </div>
  )
}
