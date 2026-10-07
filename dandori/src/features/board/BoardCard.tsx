import type { CSSProperties } from 'react'
import type { Issue, Priority } from '../../db/types'
import { formatIssueNumber } from '../../lib/issueNumber'

const PRIORITY_COLOR: Record<Priority, string> = {
  urgent: '#ef4444',
  high: '#f97316',
  medium: '#38bdf8',
  low: '#94a3b8',
}

interface Props {
  issue: Issue
  floating?: CSSProperties
  swipeDx?: number
  swipeAnimating?: boolean
  pulse?: boolean
  prevLabel?: string
  nextLabel?: string
  onOpen: () => void
}

export function BoardCard({
  issue,
  floating,
  swipeDx = 0,
  swipeAnimating = true,
  pulse,
  prevLabel,
  nextLabel,
  onOpen,
}: Props) {
  const card = (
    <div
      role="button"
      tabIndex={0}
      data-card-id={issue.id}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className={`relative flex min-h-16 touch-pan-y select-none flex-col gap-1 rounded-xl border border-border bg-surface p-3 pl-4 [-webkit-touch-callout:none] ${
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
      <span className="text-xs text-muted">
        {formatIssueNumber(issue.number)} · {issue.type}
        {issue.dueDate ? ` · 期限 ${issue.dueDate}` : ''}
      </span>
      <span className={issue.completedAt ? 'line-through opacity-60' : ''}>{issue.title}</span>
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
