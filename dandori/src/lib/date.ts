import { addDays, format, parseISO } from 'date-fns'

export const DATE_FORMAT = 'yyyy-MM-dd'

export function todayStr(now: Date = new Date()): string {
  return format(now, DATE_FORMAT)
}

export function addDaysStr(date: string, days: number): string {
  return format(addDays(parseISO(date), days), DATE_FORMAT)
}

export function isValidDateStr(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(parseISO(date).getTime())
}

// 'YYYY-MM-DD' は辞書順がそのまま日付順になる
export function isBefore(a: string, b: string): boolean {
  return a < b
}
