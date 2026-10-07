import type { Issue, Priority } from '../../db/types'
import { useRowGestures } from './useRowGestures'

const PRIORITY_COLOR: Record<Priority, string> = {
  urgent: '#ef4444',
  high: '#f97316',
  medium: '#38bdf8',
  low: '#94a3b8',
}

export function BacklogRow({
  issue,
  projectKey,
  statusName,
  onOpen,
  onMove,
}: {
  issue: Issue
  projectKey: string
  statusName: string
  onOpen: () => void
  onMove: () => void
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
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen()
          }
        }}
        className="relative flex min-h-14 touch-pan-y select-none flex-col items-start gap-1 rounded-xl border border-border bg-surface p-3 pl-4 text-left [-webkit-touch-callout:none]"
        style={{
          borderLeft: `4px solid ${PRIORITY_COLOR[issue.priority]}`,
          transform: dx ? `translateX(${dx}px)` : undefined,
          transition: swiping ? 'none' : 'transform 160ms ease-out',
        }}
      >
        <span className="text-xs text-muted">
          {projectKey}-{issue.number} · {issue.type} · {issue.priority}
          {issue.estimateMin ? ` · ${issue.estimateMin}分` : ''}
        </span>
        <span className={issue.completedAt ? 'line-through opacity-60' : ''}>{issue.title}</span>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">{statusName}</span>
      </div>
    </div>
  )
}
