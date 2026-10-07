import type { Issue } from '../../db/types'
import { formatIssueNumber } from '../../lib/issueNumber'
import type { TimelineDrag } from './useTimelineGestures'

export function UnplacedTray({
  issues,
  drag,
  hasSprint,
  onOpen,
  shouldSuppressClick,
}: {
  issues: Issue[]
  drag: TimelineDrag | null
  hasSprint: boolean
  onOpen: (issue: Issue) => void
  shouldSuppressClick: () => boolean
}) {
  const ghost = drag?.kind === 'tray' ? issues.find((i) => i.id === drag.id) : undefined

  return (
    <section aria-label="未配置のIssue" className="flex flex-col gap-1">
      <h2 className="text-xs font-semibold text-muted">
        未配置{issues.length > 0 ? `(${issues.length})` : ''}
        <span className="ml-2 font-normal">長押しでタイムラインへドラッグ / タップで時刻を入力</span>
      </h2>
      {issues.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-2 text-center text-xs text-muted">
          {hasSprint ? '未配置のスプリントIssueはありません' : 'アクティブスプリントのIssueがここに並びます'}
        </p>
      ) : (
        <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {issues.map((i) => (
            <li key={i.id} className="shrink-0">
              <div
                role="button"
                tabIndex={0}
                data-tray-id={i.id}
                onClick={() => {
                  if (!shouldSuppressClick()) onOpen(i)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onOpen(i)
                  }
                }}
                onContextMenu={(e) => e.preventDefault()}
                className={`flex min-h-11 max-w-48 touch-pan-x select-none flex-col justify-center rounded-lg border border-border bg-surface px-3 py-1 [-webkit-touch-callout:none] ${
                  ghost?.id === i.id ? 'opacity-40' : ''
                }`}
                style={{ borderLeft: `4px solid ${i.color}` }}
              >
                <span className="text-[10px] text-muted">
                  {formatIssueNumber(i.number)} · {i.durationMin}分
                </span>
                <span className="truncate text-sm">{i.title}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {drag?.kind === 'tray' && ghost && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 max-w-48 -translate-x-1/2 -translate-y-1/2 truncate rounded-lg border border-accent bg-surface px-3 py-2 text-sm shadow-xl"
          style={{ left: drag.x, top: drag.y }}
        >
          {ghost.title}
        </div>
      )}
    </section>
  )
}
