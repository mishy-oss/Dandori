import { useDataStore, selectCurrentProject } from '../../store/data'
import { monthlyWork } from '../../db/monthlyRepo'
import { todayStr } from '../../lib/date'
import { buildMonthBurndown } from './monthlyLogic'

/** 選択月の残タスク数を描く。過去月は保存済み実績を使い、将来の日付へ実績線を延ばさない。 */
export function MonthlyBurndown() {
  const month = useDataStore(/* 選択月を読む。 */ (state) => state.selectedMonth)
  const issues = useDataStore(/* 対象月の集計元を読む。 */ (state) => state.issues)
  const snapshots = useDataStore(/* 月別の日次記録を読む。 */ (state) => state.monthlySnapshots)
  const project = useDataStore(selectCurrentProject)
  const workflows = useDataStore(/* 完了カテゴリの判定に使う。 */ (state) => state.workflows)
  const statuses = project ? workflows[project.workflowId]?.statuses ?? [] : []
  const doneIds = new Set(statuses.filter(/* 完了カテゴリだけを選ぶ。 */ (status) => status.category === 'done').map(/* 判定用のIDを取り出す。 */ (status) => status.id))
  const result = buildMonthBurndown(month, snapshots, monthlyWork(issues, month, doneIds), todayStr())
  const x = 32, y = 12, width = 300, height = 110
  /** 残作業と日付位置をSVGの座標へ変換する。 */
  const point = (value: number, index: number) => `${x + index / Math.max(1, result.points.length - 1) * width},${y + height * (1 - value / result.max)}`
  const ideal = result.points.map(/* 月末に0になる理想線を作る。 */ (item, index) => point(item.ideal, index)).join(' ')
  const actual = result.points.flatMap(/* 記録済みの日だけを実績線へ変換する。 */ (item, index) => item.actual === null ? [] : [point(item.actual, index)]).join(' ')
  return <section aria-label="月次バーンダウン" className="rounded-2xl border border-border bg-surface p-4">
    <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">月次バーンダウン</h2><span className="text-xs text-muted">残り {result.remaining} / {result.total}件</span></div>
    <p className="mt-1 text-[10px] text-muted">{result.startDate} 〜 {result.endDate}</p>
    <svg viewBox="0 0 350 150" className="mt-3 h-auto w-full" role="img" aria-label={`${month}の残タスク数。残り${result.remaining}件。点線は月末までの目安、実線は記録済みの実績。`}>
      <path d={`M${x} ${y}v${height}h${width}`} fill="none" stroke="var(--border)" />
      <text x={x - 6} y={y + 4} textAnchor="end" className="fill-muted text-[10px]">{result.max}</text>
      <text x={x - 6} y={y + height + 3} textAnchor="end" className="fill-muted text-[10px]">0</text>
      <polyline points={ideal} fill="none" stroke="var(--text-muted)" strokeDasharray="4 4" strokeWidth="1.5" />
      {actual && <polyline points={actual} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
      {result.points.map(/* 記録された点を表示し、1日分だけでも実績が見えるようにする。 */ (item, index) => item.actual === null ? null : <circle key={item.date} cx={x + index / (result.points.length - 1) * width} cy={y + height * (1 - item.actual / result.max)} r="1.7" fill="var(--accent)" />)}
      <text x={x} y="143" className="fill-muted text-[10px]">1日</text><text x={x + width / 2} y="143" textAnchor="middle" className="fill-muted text-[10px]">{Math.ceil(result.points.length / 2)}日</text><text x={x + width} y="143" textAnchor="end" className="fill-muted text-[10px]">{result.points.length}日</text>
    </svg>
    <div className="flex justify-center gap-4 text-[10px] text-muted"><span className="text-accent">━ 残りタスク</span><span>┄ 月末までの目安</span></div>
    {!actual && <p className="mt-2 text-[10px] text-muted">実績はこの機能を使い始めた日から記録されます。</p>}
  </section>
}
