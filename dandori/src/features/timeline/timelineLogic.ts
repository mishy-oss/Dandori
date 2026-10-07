import { addDays, format, parseISO, startOfWeek } from 'date-fns'
import { DATE_FORMAT } from '../../lib/date'
import { MINUTES_PER_DAY } from '../../lib/schedule'

export const PX_PER_MIN = 1.2
export const SNAP_MIN = 15
export const MIN_BLOCK_DURATION_MIN = 15

export interface Range {
  startMin: number
  endMin: number
}

export interface Placed {
  id: string
  startMin: number
  durationMin: number
}

export interface BlockLayout {
  id: string
  column: number
  columns: number
}

export function snap(min: number, step = SNAP_MIN): number {
  return Math.round(min / step) * step
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export function minToY(min: number, range: Range): number {
  return (min - range.startMin) * PX_PER_MIN
}

// y(グリッド上端からのpx)を分に変換し、15分刻みに丸める
export function yToMin(y: number, range: Range): number {
  return snap(range.startMin + y / PX_PER_MIN)
}

export function formatMin(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function parseTime(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

// 設定の表示範囲に収まらないブロックがあれば、その分だけ時間軸を広げる(見えないIssueを作らない)
export function visibleRange(dayStartHour: number, dayEndHour: number, blocks: Placed[]): Range {
  let startMin = dayStartHour * 60
  let endMin = dayEndHour * 60
  for (const b of blocks) {
    startMin = Math.min(startMin, Math.floor(b.startMin / 60) * 60)
    endMin = Math.max(endMin, Math.min(MINUTES_PER_DAY, Math.ceil((b.startMin + b.durationMin) / 60) * 60))
  }
  return { startMin, endMin }
}

export function clampMove(startMin: number, durationMin: number, range: Range): number {
  return clamp(snap(startMin), range.startMin, Math.max(range.startMin, range.endMin - durationMin))
}

export function clampResize(durationMin: number, startMin: number, range: Range): number {
  const max = Math.max(MIN_BLOCK_DURATION_MIN, range.endMin - startMin)
  return clamp(snap(durationMin), MIN_BLOCK_DURATION_MIN, max)
}

// 上端ドラッグ: 元のブロックの終了時刻を固定したまま、開始時刻だけ proposedStart へ動かす。
// 15分スナップ、最短15分、表示範囲の上端までに収める
export function clampResizeTop(
  proposedStart: number,
  base: { startMin: number; durationMin: number },
  range: Range,
): { startMin: number; durationMin: number } {
  const end = base.startMin + base.durationMin
  const startMin = clamp(snap(proposedStart), range.startMin, Math.max(range.startMin, end - MIN_BLOCK_DURATION_MIN))
  return { startMin, durationMin: end - startMin }
}

// 開始時刻でソート → 重なるものをクラスタ化 → 空いている最初の列に割り当て → 列数nで幅を1/nにする
export function layoutBlocks(blocks: Placed[]): BlockLayout[] {
  const sorted = [...blocks].sort(
    (a, b) => a.startMin - b.startMin || b.durationMin - a.durationMin || a.id.localeCompare(b.id),
  )
  const result: BlockLayout[] = []

  let cluster: { block: Placed; column: number }[] = []
  let columnEnds: number[] = []
  let clusterEnd = -1

  const flush = () => {
    const columns = columnEnds.length
    for (const c of cluster) result.push({ id: c.block.id, column: c.column, columns })
    cluster = []
    columnEnds = []
    clusterEnd = -1
  }

  for (const block of sorted) {
    if (cluster.length > 0 && block.startMin >= clusterEnd) flush()
    let column = columnEnds.findIndex((end) => end <= block.startMin)
    if (column === -1) {
      column = columnEnds.length
      columnEnds.push(0)
    }
    const end = block.startMin + block.durationMin
    columnEnds[column] = end
    clusterEnd = Math.max(clusterEnd, end)
    cluster.push({ block, column })
  }
  flush()
  return result
}

export function weekDays(date: string, weekStartsOn: 0 | 1): string[] {
  const start = startOfWeek(parseISO(date), { weekStartsOn })
  return Array.from({ length: 7 }, (_, i) => format(addDays(start, i), DATE_FORMAT))
}

export function nowMin(now: Date = new Date()): number {
  return now.getHours() * 60 + now.getMinutes()
}
