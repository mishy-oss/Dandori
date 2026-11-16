import { addMonths, format, parseISO, endOfMonth } from 'date-fns'
import type { Issue } from '../db/types'
import { todayStr } from './date'

export function isValidMonth(month: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
}

export function currentMonth(date = new Date()): string {
  return todayStr(date).slice(0, 7)
}

export function monthRange(month: string): { startDate: string; endDate: string } {
  if (!isValidMonth(month)) throw new Error('対象月を正しく指定してください')
  const startDate = `${month}-01`
  return { startDate, endDate: format(endOfMonth(parseISO(startDate)), 'yyyy-MM-dd') }
}

export function shiftMonth(month: string, offset: number): string {
  monthRange(month)
  return format(addMonths(parseISO(`${month}-01`), offset), 'yyyy-MM')
}

export function issueMonth(issue: Issue): string {
  return issue.planningMonth ?? issue.date?.slice(0, 7) ?? issue.dueDate?.slice(0, 7) ?? currentMonth(new Date(issue.createdAt))
}
