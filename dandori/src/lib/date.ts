import { addDays, differenceInCalendarWeeks, format, getDay, parseISO, startOfWeek } from 'date-fns'

export const DATE_FORMAT = 'yyyy-MM-dd'

/** 指定日時を端末のローカル日付としてyyyy-MM-dd形式で返す。省略時は今日の日付を使う。 */
export function todayStr(now: Date = new Date()): string {
  return format(now, DATE_FORMAT)
}

/** 日付文字列に指定日数を加減し、yyyy-MM-dd形式の日付文字列で返す。 */
export function addDaysStr(date: string, days: number): string {
  return format(addDays(parseISO(date), days), DATE_FORMAT)
}

/** 日単位または週単位の間隔を日数へ換算して、次回の繰り返し日を求める。 */
export function nextRecurrenceDate(
  date: string,
  frequency: 'daily' | 'weekly',
  interval: number,
): string {
  return addDaysStr(date, frequency === 'daily' ? interval : interval * 7)
}

/** 開始日を含む週を基準に指定週数の間隔と選択曜日を満たす次の日を探す。該当日を計算できなければエラーにする。 */
export function nextWeeklyRecurrenceDate(
  date: string,
  weekdays: number[],
  interval: number,
  startDate: string,
): string {
  const selected = new Set(weekdays)
  const anchorWeek = startOfWeek(parseISO(startDate), { weekStartsOn: 1 })
  for (let offset = 1; offset <= interval * 7 + 7; offset += 1) {
    const candidate = addDaysStr(date, offset)
    const candidateDate = parseISO(candidate)
    const weekOffset = differenceInCalendarWeeks(candidateDate, anchorWeek, { weekStartsOn: 1 })
    if (weekOffset >= 0 && weekOffset % interval === 0 && selected.has(getDay(candidateDate))) {
      return candidate
    }
  }
  throw new Error('次回の繰り返し日を計算できませんでした')
}

/** 日付がyyyy-MM-dd形式で、日付として解釈できるかを判定する。 */
export function isValidDateStr(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(parseISO(date).getTime())
}

// 'YYYY-MM-DD' は辞書順がそのまま日付順になる
export function isBefore(a: string, b: string): boolean {
  return a < b
}
