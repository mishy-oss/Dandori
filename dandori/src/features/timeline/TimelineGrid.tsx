import { useRef, type CSSProperties, type RefObject } from 'react'
import type { Issue } from '../../db/types'
import { Icon } from '../../app/Icon'
import { PX_PER_MIN, clampMove, formatMin, layoutBlocks, minToY, type Range } from './timelineLogic'
import type { TimelineDrag } from './useTimelineGestures'
import { taskAppearance } from './taskAppearance'

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

/** 時刻に沿う縦線に色付きアイコンと予定を配置する。重なりを列に分け、ドラッグと上下端リサイズも受け付ける。 */
export function TimelineGrid({ gridRef, range, blocks, drag, trayDurationMin, nowMin, doneIds, onCreateAt, onOpen, onToggleDone, shouldSuppressClick }: Props) {
  const height = (range.endMin - range.startMin) * PX_PER_MIN
  const downOnGrid = useRef(false)
  const shown = blocks.map(/* 操作中の予定だけプレビューの時刻を反映する。 */ (issue) => {
    if (drag?.id === issue.id) {
      if (drag.kind === 'move') return { issue, startMin: drag.startMin, durationMin: issue.durationMin }
      if (drag.kind === 'resize') return { issue, startMin: issue.startMin!, durationMin: drag.durationMin }
      if (drag.kind === 'resize-top') return { issue, startMin: drag.startMin, durationMin: drag.durationMin }
    }
    return { issue, startMin: issue.startMin!, durationMin: issue.durationMin }
  })
  const layouts = new Map(layoutBlocks(shown.map(/* 重なり計算用の時刻を取り出す。 */ (item) => ({ id: item.issue.id, startMin: item.startMin, durationMin: item.durationMin }))).map(/* IDで列配置を参照する組を作る。 */ (item) => [item.id, item]))
  const firstHour = Math.ceil(range.startMin / 60)
  const hours = Array.from({ length: Math.floor(range.endMin / 60) - firstHour + 1 }, /* 時間目盛りを生成する。 */ (_, index) => firstHour + index)

  /** 空き枠のタップ位置を15分刻みの開始時刻に変換して、新規作成を依頼する。 */
  function onGridClick(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || !downOnGrid.current || shouldSuppressClick()) return
    const raw = range.startMin + (event.clientY - event.currentTarget.getBoundingClientRect().top) / PX_PER_MIN
    onCreateAt(clampMove(Math.floor(raw / 15) * 15, trayDurationMin, range))
  }

  return (
    <div className="relative ml-11 mr-4" style={{ height }}>
      <div ref={gridRef} data-timeline-grid aria-label="タイムライン（空き枠をタップして新規作成）" className="absolute inset-0"
        onClick={onGridClick}
        onPointerDownCapture={/* 空き枠で押し始めたかを記録する。 */ (event) => { downOnGrid.current = event.target === event.currentTarget }}
        onContextMenu={/* 長押しの標準メニューを抑止する。 */ (event) => event.preventDefault()}>
        <div aria-hidden className="pointer-events-none absolute bottom-0 left-[21px] top-0 w-0.5 bg-border" />
        {hours.map(/* 時間ラベルを表示する。 */ (hour) => (
          <div key={hour} aria-hidden className="pointer-events-none absolute -left-11 w-9 -translate-y-1/2 text-right text-[10px] tabular-nums text-muted" style={{ top: minToY(hour * 60, range), opacity: nowMin !== null && Math.abs(nowMin - hour * 60) < 8 ? 0 : 1 }}>{formatMin(hour * 60)}</div>
        ))}
        {drag?.kind === 'tray' && drag.startMin !== null && <div aria-hidden className="pointer-events-none absolute inset-x-0 rounded-3xl border border-dashed border-accent bg-accent/5" style={{ top: minToY(drag.startMin, range), height: trayDurationMin * PX_PER_MIN }} />}
        {shown.map(/* 各予定のアイコン・時間・タイトル・完了ボタンを描く。 */ ({ issue, startMin, durationMin }) => {
          const layout = layouts.get(issue.id)!
          const done = doneIds.has(issue.statusId)
          const active = drag !== null && drag.kind !== 'tray' && drag.id === issue.id
          const { color, icon } = taskAppearance(issue)
          const blockHeight = Math.max(16, durationMin * PX_PER_MIN - 4)
          const compact = blockHeight < 36
          const narrow = layout.columns > 1
          const iconSize = Math.min(44, blockHeight)
          return (
            <div key={issue.id} role="button" tabIndex={0} data-block-id={issue.id} aria-label={`${issue.title} ${formatMin(startMin)}から${durationMin}分`}
              onClick={/* ジェスチャー直後以外は編集を開く。 */ () => { if (!shouldSuppressClick()) onOpen(issue) }}
              onKeyDown={/* キーボードから予定を開く。 */ (event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onOpen(issue) } }}
              className={`timeline-block group absolute touch-pan-y select-none rounded-2xl text-left [-webkit-touch-callout:none] ${active ? 'z-20 bg-surface shadow-lg ring-1 ring-accent/40' : 'z-10'} ${done ? 'opacity-45' : ''}`}
              style={{ '--task-color': color, top: minToY(startMin, range), height: blockHeight, left: `calc(${layout.column * 100 / layout.columns}% + 1px)`, width: `calc(${100 / layout.columns}% - 3px)`, transition: active ? 'none' : 'top 120ms ease-out, height 120ms ease-out' } as CSSProperties}>
              <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 flex items-center justify-center rounded-full text-white" style={{ width: narrow ? Math.min(30, iconSize) : iconSize, background: color }}><Icon name={done ? 'check' : icon} className={compact ? 'size-3' : narrow ? 'size-4' : 'size-[22px]'} /></div>
              <div className="pointer-events-none absolute inset-y-0 flex min-w-0 flex-col justify-center gap-0.5" style={{ left: narrow ? 38 : 58, right: narrow ? 27 : 42 }}>
                {!compact && <p className="truncate text-[10px] tabular-nums leading-snug text-muted">{formatMin(startMin)}–{formatMin(startMin + durationMin)} <span className="ml-1">{durationMin} 分</span></p>}
                <p className={`${compact ? 'text-[10px]' : 'text-[13px]'} truncate font-semibold leading-snug tracking-[-0.015em] ${done ? 'line-through' : ''}`}>{issue.recurrenceId && <span className="mr-1 text-muted">↻</span>}{issue.title}</p>
              </div>
              <button type="button" data-no-drag aria-label={done ? `${issue.title} を未完了に戻す` : `${issue.title} を完了にする`} aria-pressed={done}
                onClick={/* 編集を開かず完了状態だけ切り替える。 */ (event) => { event.stopPropagation(); onToggleDone(issue) }}
                onKeyDown={/* キー操作を親の編集処理へ伝えない。 */ (event) => event.stopPropagation()}
                className="absolute inset-y-0 right-0 flex items-center justify-center" style={{ width: narrow ? 27 : 40 }}>
                <span className="flex size-[19px] items-center justify-center rounded-full border-[1.5px]" style={{ borderColor: color, color: done ? 'white' : color, background: done ? color : 'var(--surface)' }}>{done && <Icon name="check" className="size-3" />}</span>
              </button>
              <div data-resize-top-id={issue.id} aria-hidden className="absolute left-0 top-0 flex h-2 touch-none items-start justify-center" style={{ width: narrow ? 30 : 44 }}><span className="resize-grip mt-0.5 h-0.5 w-4 rounded-full bg-white" /></div>
              <div data-resize-id={issue.id} aria-hidden className="absolute bottom-0 left-0 flex h-2 touch-none items-end justify-center" style={{ width: narrow ? 30 : 44 }}><span className="resize-grip mb-0.5 h-0.5 w-4 rounded-full bg-white" /></div>
            </div>
          )
        })}
        {nowMin !== null && nowMin >= range.startMin && nowMin <= range.endMin && (
          <div aria-hidden data-now-line className="pointer-events-none absolute inset-x-0 z-30" style={{ top: minToY(nowMin, range) }}>
            <span className="absolute -left-11 w-9 -translate-y-1/2 text-right text-[10px] font-semibold tabular-nums text-accent">{formatMin(nowMin)}</span>
            <span className="absolute left-[18px] size-2 -translate-y-1/2 rounded-full bg-accent ring-4 ring-surface" />
            <span className="absolute left-7 right-0 h-px bg-gradient-to-r from-accent/60 to-transparent" />
          </div>
        )}
      </div>
    </div>
  )
}
