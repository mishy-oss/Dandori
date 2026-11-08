import type { MonthlySnapshot } from '../../db/types'
import { addDaysStr } from '../../lib/date'
import { monthRange } from '../../lib/month'

/** 月初から月末の理想線と、実際に記録を開始した日以降の実績線を組み立てる。未記録の過去や未来の実績は作らない。 */
export function buildMonthBurndown(month: string, snapshots: MonthlySnapshot[], summary: { totalCount: number; remainingCount: number }, today: string) {
  const range = monthRange(month)
  const records = snapshots.filter(/* 対象月に実際に記録した実績だけを使う。 */ (record) => record.month === month && record.date >= range.startDate && record.date <= range.endDate && record.date <= today).sort(/* 日付順に記録を読む。 */ (a, b) => a.date.localeCompare(b.date))
  const baseline = Math.max(summary.totalCount, 0, ...records.map(/* 月の途中で追加した作業も理想線の目安へ含める。 */ (record) => record.totalCount))
  const latest = records.at(-1)
  const dates: string[] = []
  for (let date = range.startDate; date <= range.endDate; date = addDaysStr(date, 1)) dates.push(date)
  let cursor = 0
  let actual: number | null = null
  const points = dates.map(/* 記録のない日は直前の値を引き継ぎ、記録開始前と未来は空白にする。 */ (date, index) => {
    while (cursor < records.length && records[cursor].date <= date) actual = records[cursor++].remainingCount
    return { date, ideal: baseline * (1 - index / Math.max(1, dates.length - 1)), actual: date <= today ? actual : null }
  })
  return { ...range, points, total: latest?.totalCount ?? summary.totalCount, remaining: latest?.remainingCount ?? summary.remainingCount, max: Math.max(1, baseline, summary.totalCount, ...records.map(/* 途中で追加された作業もグラフ範囲へ収める。 */ (record) => Math.max(record.totalCount, record.remainingCount))) }
}
