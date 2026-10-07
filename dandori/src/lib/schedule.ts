import { isValidDateStr } from './date'

export const MINUTES_PER_DAY = 1440
export const MIN_DURATION_MIN = 5

// 日付をまたぐ配置は扱わないため、開始+所要時間は24:00以内に収める
export function validateSchedule(
  date: string | null,
  startMin: number | null,
  durationMin: number,
): void {
  if (date !== null && !isValidDateStr(date)) throw new Error('日付を正しく入力してください')
  if (!Number.isInteger(durationMin) || durationMin < MIN_DURATION_MIN || durationMin > MINUTES_PER_DAY) {
    throw new Error('所要時間は5分以上で指定してください')
  }
  if (startMin !== null) {
    if (date === null) throw new Error('時刻を設定するには日付が必要です')
    if (!Number.isInteger(startMin) || startMin < 0 || startMin >= MINUTES_PER_DAY) {
      throw new Error('開始時刻が正しくありません')
    }
    if (startMin + durationMin > MINUTES_PER_DAY) throw new Error('終了が24:00を超えています')
  }
}
