import type { CSSProperties } from 'react'
import { DoneCheckButton } from '../../app/DoneCheckButton'
import { PRIORITY_LABELS, type Issue, type Priority } from '../../db/types'
import { formatIssueNumber } from '../../lib/issueNumber'
import { TaskRelations } from './TaskRelations'

const PRIORITY_COLOR: Record<Priority, string> = {
  urgent: '#ef4444',
  highest: '#e85d75',
  high: '#f97316',
  medium: '#38bdf8',
  low: '#94a3b8',
}

interface Props {
  issue: Issue
  done: boolean
  floating?: CSSProperties
  swipeDx?: number
  swipeAnimating?: boolean
  pulse?: boolean
  prevLabel?: string
  nextLabel?: string
  onOpen: () => void
  onToggleDone: () => void
  onMove?: () => void
  relatedIssues?: Issue[]
  doneIds?: Set<string>
}

export function BoardCard({
  issue,
  done,
  floating,
  swipeDx = 0,
  swipeAnimating = true,
  pulse,
  prevLabel,
  nextLabel,
  onOpen,
  onToggleDone,
  onMove,
  relatedIssues = [],
  doneIds = new Set(),
}: Props) {
  const card = (
    <div
      role="button"
      tabIndex={0}
      data-card-id={issue.id}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onOpen()
        }
      }}
      className={`relative flex min-h-16 touch-pan-y select-none items-center gap-1 rounded-xl border border-border bg-surface py-1 pl-1 pr-3 [-webkit-touch-callout:none] ${
        pulse ? 'animate-pop' : ''
      } ${floating ? 'z-50 scale-[1.03] shadow-2xl' : ''}`}
      style={{
        ...(floating ?? {
          transform: swipeDx ? `translateX(${swipeDx}px)` : undefined,
          transition: swipeAnimating ? 'transform 160ms ease-out' : 'none',
        }),
        borderLeft: `4px solid ${PRIORITY_COLOR[issue.priority]}`,
      }}
    >
      <DoneCheckButton done={done} onToggle={onToggleDone} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-xs text-muted">
          {formatIssueNumber(issue.number)} · {issue.type} · {PRIORITY_LABELS[issue.priority]}
          {issue.recurrenceId ? ' · ↻' : ''}
          {issue.estimateMin ? ` · ${issue.estimateMin} 分` : ''}
          {issue.dueDate ? ` · 期限 ${issue.dueDate}` : ''}
        </span>
        <span className={done ? 'line-through opacity-60' : ''}>{issue.title}</span>
        <TaskRelations issue={issue} issues={relatedIssues} doneIds={doneIds} />
      </div>
      {onMove && <button type="button" data-no-drag aria-label={`${issue.title}の対象月を変更`}
        className="min-h-11 shrink-0 rounded-lg border border-border px-2 text-xs text-muted"
        onClick={(event) => { event.stopPropagation(); onMove() }}>対象月</button>}
    </div>
  )

  if (floating) return card

  return (
    <div className="relative overflow-hidden rounded-xl">
      {swipeDx !== 0 && (
        <div
          aria-hidden
          className="absolute inset-0 flex items-center justify-between bg-accent/20 px-4 text-sm font-semibold text-accent"
        >
          <span>{swipeDx > 0 ? `← ${prevLabel ?? ''}` : ''}</span>
          <span>{swipeDx < 0 ? `${nextLabel ?? ''} →` : ''}</span>
        </div>
      )}
      {card}
    </div>
  )
}
