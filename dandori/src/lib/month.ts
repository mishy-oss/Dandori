import { addMonths, format, parseISO, endOfMonth } from 'date-fns'
import type { Issue } from '../db/types'
import { todayStr } from './date'

/** yyyy-MM形式で実在する月かを検証する。 */
export function isValidMonth(month: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
}

/** 端末のローカル日時から現在の対象月を返す。 */
export function currentMonth(date = new Date()): string {
  return todayStr(date).slice(0, 7)
}

/** 対象月の初日と末日を返し、うるう年の2月にも対応する。 */
export function monthRange(month: string): { startDate: string; endDate: string } {
  if (!isValidMonth(month)) throw new Error('対象月を正しく指定してください')
  const startDate = `${month}-01`
  return { startDate, endDate: format(endOfMonth(parseISO(startDate)), 'yyyy-MM-dd') }
}

/** 月を前後へ移動する。年をまたいでもyyyy-MM形式を維持する。 */
export function shiftMonth(month: string, offset: number): string {
  monthRange(month)
  return format(addMonths(parseISO(`${month}-01`), offset), 'yyyy-MM')
}

/** 対象月を求める。旧データは予定日、期限、作成日の順で補完する。 */
export function issueMonth(issue: Issue): string {
  return issue.planningMonth ?? issue.date?.slice(0, 7) ?? issue.dueDate?.slice(0, 7) ?? currentMonth(new Date(issue.createdAt))
}
