import { addDaysStr, todayStr } from '../../lib/date'
import type { Issue, Sprint, SprintSnapshot } from '../../db/types'

interface Point {
  date: string
  actual: number
  ideal: number
}

function buildPoints(sprint: Sprint, issues: Issue[], doneIds: Set<string>): { points: Point[]; unit: string; current: number; total: number } | null {
  const snapshots = [...sprint.snapshots].sort((a, b) => a.date.localeCompare(b.date))
  const sprintIssues = issues.filter((i) => i.sprintId === sprint.id && i.deletedAt === null)
  const parentsWithChildren = new Set(sprintIssues.flatMap((i) => (i.parentId ? [i.parentId] : [])))
  const workItems = sprintIssues.filter((i) => i.type !== 'epic' && !parentsWithChildren.has(i.id))
  const currentCount = workItems.filter((i) => !doneIds.has(i.statusId)).length
  const currentMin = workItems
    .filter((i) => !doneIds.has(i.statusId))
    .reduce((sum, i) => sum + (i.estimateMin ?? 0), 0)
  const latest = snapshots.at(-1)
  const useMinutes = snapshots.some((s) => (s.totalMin ?? s.remainingMin) > 0) || workItems.some((i) => (i.estimateMin ?? 0) > 0)
  const value = (snapshot: SprintSnapshot, remaining: boolean) =>
    useMinutes
      ? remaining ? snapshot.remainingMin : (snapshot.totalMin ?? snapshot.remainingMin)
      : remaining ? snapshot.remainingCount : (snapshot.totalCount ?? snapshot.remainingCount)
  const total = useMinutes
    ? (latest ? value(latest, false) : workItems.reduce((sum, i) => sum + (i.estimateMin ?? 0), 0))
    : (latest ? value(latest, false) : workItems.length)
  const actualNow = sprint.state === 'closed' && latest
    ? useMinutes ? latest.remainingMin : latest.remainingCount
    : useMinutes ? currentMin : currentCount
  if (!snapshots.length && total === 0) return null

  const firstSnapshot = snapshots.find((s) => s.date >= sprint.startDate) ?? snapshots[0]
  const baseline = firstSnapshot
    ? Math.max(value(firstSnapshot, false), value(firstSnapshot, true))
    : total
  const span = Math.max(1, Math.round((Date.parse(`${sprint.endDate}T00:00:00`) - Date.parse(`${sprint.startDate}T00:00:00`)) / 86_400_000))
  const allDates: string[] = []
  for (let date = sprint.startDate; date <= sprint.endDate; date = addDaysStr(date, 1)) allDates.push(date)
  const availableSnapshots = snapshots.filter((s) => s.date >= sprint.startDate)
  let lastActual = baseline
  const points = allDates.map((date, index) => {
    const exact = availableSnapshots.filter((s) => s.date === date).at(-1)
    const lateFinal = date === sprint.endDate
      ? availableSnapshots.filter((s) => s.date > sprint.endDate).at(-1)
      : undefined
    if (exact) lastActual = value(exact, true)
    else if (lateFinal) lastActual = value(lateFinal, true)
    return { date, actual: lastActual, ideal: baseline * (1 - index / span) }
  })
  return { points, unit: useMinutes ? '分' : '件', current: actualNow, total: baseline }
}

export function BurndownChart({ sprint, issues, doneIds }: { sprint: Sprint; issues: Issue[]; doneIds: Set<string> }) {
  const result = buildPoints(sprint, issues, doneIds)
  if (!result) {
    return <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted">バーンダウンを表示する作業Issueがありません</p>
  }

  const { points, unit, current, total } = result
  const width = 340
  const height = 148
  const left = 34
  const right = 10
  const top = 12
  const bottom = 28
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const max = Math.max(1, total)
  const pointAt = (value: number, index: number) =>
    `${left + (index / Math.max(points.length - 1, 1)) * plotWidth},${top + (1 - value / max) * plotHeight}`
  const ideal = points.map((p, i) => pointAt(p.ideal, i)).join(' ')
  const currentDate = sprint.state === 'closed'
    ? sprint.endDate
    : todayStr() < sprint.startDate
      ? sprint.startDate
      : todayStr() > sprint.endDate
        ? sprint.endDate
        : todayStr()
  const actual = points
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.date <= currentDate)
    .map(({ p, i }) => pointAt(p.actual, i))
    .join(' ')
  const middle = points[Math.floor((points.length - 1) / 2)]
  const last = points.at(-1)!

  return (
    <div className="rounded-lg border border-border bg-surface p-3" aria-label="スプリントのバーンダウン">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">バーンダウン</h3>
        <span className="text-xs text-muted">残り {current}{unit} / 合計 {total}{unit}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={`残り${unit}の推移。実績は${current}${unit}、理想線は${total}${unit}から0${unit}です`}>
        <line x1={left} y1={top} x2={left} y2={top + plotHeight} stroke="var(--border)" />
        <line x1={left} y1={top + plotHeight} x2={width - right} y2={top + plotHeight} stroke="var(--border)" />
        <text x={left - 5} y={top + 4} textAnchor="end" className="fill-muted text-[10px]">{total}</text>
        <text x={left - 5} y={top + plotHeight + 3} textAnchor="end" className="fill-muted text-[10px]">0</text>
        <polyline points={ideal} fill="none" stroke="var(--text-muted)" strokeDasharray="4 4" strokeWidth="2" />
        <polyline points={actual} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <text x={left} y={height - 7} textAnchor="start" className="fill-muted text-[10px]">{sprint.startDate.slice(5)}</text>
        {middle && <text x={left + plotWidth / 2} y={height - 7} textAnchor="middle" className="fill-muted text-[10px]">{middle.date.slice(5)}</text>}
        <text x={width - right} y={height - 7} textAnchor="end" className="fill-muted text-[10px]">{sprint.endDate.slice(5)}</text>
      </svg>
      <div className="flex justify-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1"><i className="h-0.5 w-4 bg-accent" />実績({todayStr()})</span>
        <span className="flex items-center gap-1"><i className="h-0.5 w-4 border-t border-dashed border-muted" />理想</span>
      </div>
      <span className="sr-only">{last.date} 時点の期間終了</span>
    </div>
  )
}
