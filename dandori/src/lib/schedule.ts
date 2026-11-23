import { isValidDateStr } from './date'

export const MINUTES_PER_DAY = 1440
export const MIN_DURATION_MIN = 5
const DURATION_INTEGER_ERROR = '所要時間は分単位の整数で指定してください'

export function durationError(durationMin: number): string | null {
  if (!Number.isInteger(durationMin)) return DURATION_INTEGER_ERROR
  if (durationMin < MIN_DURATION_MIN) return '所要時間は5分以上で指定してください'
  if (durationMin > MINUTES_PER_DAY) return '所要時間は1440分（24時間）以内で指定してください'
  return null
}

export function scheduleError(date: unknown, startMin: unknown, durationMin: unknown): string | null {
  if (date !== null && (typeof date !== 'string' || !isValidDateStr(date))) return '日付を正しく入力してください'
  if (typeof durationMin !== 'number') return DURATION_INTEGER_ERROR
  const error = durationError(durationMin)
  if (error) return error
  if (startMin === null) return null
  if (date === null) return '時刻を設定するには日付が必要です'
  if (typeof startMin !== 'number' || !Number.isInteger(startMin) || startMin < 0 || startMin >= MINUTES_PER_DAY) {
    return '開始時刻が正しくありません'
  }
  // 日付をまたぐ配置は扱わないため、開始+所要時間は24:00以内に収める。
  if (startMin + durationMin > MINUTES_PER_DAY) return '終了が24:00を超えています'
  return null
}

export function validateSchedule(date: string | null, startMin: number | null, durationMin: number): void {
  const error = scheduleError(date, startMin, durationMin)
  if (error) throw new Error(error)
}
