import { useRef, type RefObject } from 'react'
import type { Issue } from '../../db/types'
import { PX_PER_MIN, clampMove, formatMin, layoutBlocks, minToY, type Range } from './timelineLogic'
import type { TimelineDrag } from './useTimelineGestures'

const MIN_BLOCK_HEIGHT_PX = 18

interface Props {
  gridRef: RefObject<HTMLDivElement | null>
  range: Range
  blocks: Issue[]
  drag: TimelineDrag | null
  trayDurationMin: number
  nowMin: number | null
  doneIds: Set<string>
  onCreateAt: (startMin: number) => void
  onOpen: (issue: Issue) => void
  onToggleDone: (issue: Issue) => void
  shouldSuppressClick: () => boolean
}

export function TimelineGrid({
  gridRef,
  range,
  blocks,
  drag,
  trayDurationMin,
  nowMin,
  doneIds,
  onCreateAt,
  onOpen,
  onToggleDone,
  shouldSuppressClick,
}: Props) {
  const height = (range.endMin - range.startMin) * PX_PER_MIN

  // ドラッグ中のプレビュー位置/長さを反映して重なりを再計算する
  const shown = blocks.map((b) => {
    if (drag?.kind === 'move' && drag.id === b.id) return { issue: b, startMin: drag.startMin, durationMin: b.durationMin }
    if (drag?.kind === 'resize' && drag.id === b.id) return { issue: b, startMin: b.startMin!, durationMin: drag.durationMin }
    if (drag?.kind === 'resize-top' && drag.id === b.id) {
      return { issue: b, startMin: drag.startMin, durationMin: drag.durationMin }
    }
    return { issue: b, startMin: b.startMin!, durationMin: b.durationMin }
  })
  const layout = new Map(
    layoutBlocks(shown.map((s) => ({ id: s.issue.id, startMin: s.startMin, durationMin: s.durationMin }))).map((l) => [l.id, l]),
  )

  const firstHour = Math.ceil(range.startMin / 60)
  const lastHour = Math.floor(range.endMin / 60)
  const hours = Array.from({ length: lastHour - firstHour + 1 }, (_, i) => firstHour + i)

  // 押下が空き枠で始まったときだけ「空き枠タップ」とみなす(ブロックから動かして離した場合を除く)
  const downOnGrid = useRef(false)

  function onGridClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget || !downOnGrid.current || shouldSuppressClick()) return
    const rect = e.currentTarget.getBoundingClientRect()
    const raw = range.startMin + (e.clientY - rect.top) / PX_PER_MIN
    onCreateAt(clampMove(Math.floor(raw / 15) * 15, trayDurationMin, range))
  }

  return (
    <div className="relative ml-12 mr-3" style={{ height }}>
      <div
        ref={gridRef}
        data-timeline-grid
        aria-label="タイムライン(空き枠をタップして新規作成)"
        className="absolute inset-0"
        onClick={onGridClick}
        onPointerDownCapture={(e) => {
          downOnGrid.current = e.target === e.currentTarget
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {hours.map((h) => (
          <div
            key={h}
            aria-hidden
            className="pointer-events-none absolute left-0 right-0 border-t border-border"
            style={{ top: minToY(h * 60, range) }}
          >
            <span className="absolute -left-12 w-10 -translate-y-1/2 pr-1 text-right text-xs text-muted">
              {String(h).padStart(2, '0')}:00
            </span>
          </div>
        ))}

        {drag?.kind === 'tray' && drag.startMin !== null && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 rounded-lg border-2 border-dashed border-accent bg-accent/10"
            style={{ top: minToY(drag.startMin, range), height: trayDurationMin * PX_PER_MIN }}
          />
        )}

        {shown.map(({ issue, startMin, durationMin }) => {
          const l = layout.get(issue.id)!
          const done = doneIds.has(issue.statusId)
          const active = drag !== null && drag.kind !== 'tray' && drag.id === issue.id
          const widthPct = 100 / l.columns
          const blockHeight = Math.max(MIN_BLOCK_HEIGHT_PX, durationMin * PX_PER_MIN) - 2
          return (
            <div
              key={issue.id}
              role="button"
              tabIndex={0}
              data-block-id={issue.id}
              aria-label={`${issue.title} ${formatMin(startMin)}から${durationMin}分`}
              onClick={() => {
                if (!shouldSuppressClick()) onOpen(issue)
              }}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault()
                  onOpen(issue)
                }
              }}
              className={`absolute touch-pan-y select-none overflow-hidden rounded-lg border text-left [-webkit-touch-callout:none] ${
                active ? 'z-20 shadow-xl ring-2 ring-accent' : 'z-10'
              } ${done ? 'opacity-60' : ''}`}
              style={{
                top: minToY(startMin, range),
                height: blockHeight,
                left: `calc(${l.column * widthPct}% + 1px)`,
                width: `calc(${widthPct}% - 2px)`,
                background: `color-mix(in srgb, ${issue.color} 25%, var(--surface))`,
                borderColor: issue.color,
                borderLeftWidth: 4,
                transition: active ? 'none' : 'top 120ms ease-out, height 120ms ease-out',
              }}
            >
              <div className="flex items-start gap-1 px-1 py-0.5">
                <button
                  type="button"
                  data-no-drag
                  aria-label={done ? '未完了に戻す' : '完了にする'}
                  aria-pressed={done}
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleDone(issue)
                  }}
                  className={`mt-px flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] leading-none ${
                    done ? 'border-accent bg-accent text-accent-text' : 'border-muted'
                  }`}
                >
                  {done ? '✓' : ''}
                </button>
                <div className="min-w-0 flex-1 leading-tight">
                  <p className={`truncate text-xs font-medium ${done ? 'line-through' : ''}`}>{issue.title}</p>
                  {durationMin >= 45 && (
                    <p className="truncate text-[10px] text-muted">
                      {formatMin(startMin)}–{formatMin(startMin + durationMin)}
                    </p>
                  )}
                </div>
              </div>
              {/* 上端ハンドル。上下のハンドルを中央で揃える */}
              <div
                data-resize-top-id={issue.id}
                aria-hidden
                className="absolute inset-x-0 top-0 flex touch-none items-start justify-center"
                style={{ height: Math.min(16, Math.round(blockHeight * 0.35)) }}
              >
                <span className="mt-0.5 h-1 w-8 rounded-full bg-muted/60" />
              </div>
              <div
                data-resize-id={issue.id}
                aria-hidden
                className="absolute inset-x-0 bottom-0 flex touch-none items-end justify-center"
                style={{ height: Math.min(16, Math.round(blockHeight * 0.35)) }}
              >
                <span className="mb-0.5 h-1 w-8 rounded-full bg-muted/60" />
              </div>
            </div>
          )
        })}

        {nowMin !== null && nowMin >= range.startMin && nowMin <= range.endMin && (
          <div
            aria-hidden
            data-now-line
            className="pointer-events-none absolute -left-1 right-0 z-30 border-t-2 border-red-500"
            style={{ top: minToY(nowMin, range) }}
          >
            <span className="absolute -left-1 -top-[5px] size-2 rounded-full bg-red-500" />
          </div>
        )}
      </div>
    </div>
  )
}
