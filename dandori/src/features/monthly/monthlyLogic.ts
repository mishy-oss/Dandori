import type { MonthlySnapshot } from '../../db/types'
import { addDaysStr } from '../../lib/date'
import { monthRange } from '../../lib/month'

/* 未記録の日を実績と誤認させないよう、過去や未来の値を補間しない。 */
export function buildMonthBurndown(month: string, snapshots: MonthlySnapshot[], summary: { totalCount: number; remainingCount: number }, today: string) {
  const range = monthRange(month)
  const records = snapshots.filter((record) => record.month === month && record.date >= range.startDate && record.date <= range.endDate && record.date <= today).sort((a, b) => a.date.localeCompare(b.date))
  const baseline = Math.max(summary.totalCount, 0, ...records.map((record) => record.totalCount))
  const latest = records.at(-1)
  const dates: string[] = []
  for (let date = range.startDate; date <= range.endDate; date = addDaysStr(date, 1)) dates.push(date)
  let cursor = 0
  let actual: number | null = null
  const points = dates.map((date, index) => {
    while (cursor < records.length && records[cursor].date <= date) actual = records[cursor++].remainingCount
    return { date, ideal: baseline * (1 - index / Math.max(1, dates.length - 1)), actual: date <= today ? actual : null }
  })
  return { ...range, points, total: latest?.totalCount ?? summary.totalCount, remaining: latest?.remainingCount ?? summary.remainingCount, max: Math.max(1, baseline, summary.totalCount, ...records.map((record) => Math.max(record.totalCount, record.remainingCount))) }
}
