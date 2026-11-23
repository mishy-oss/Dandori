import { formatMin, parseTime } from '../timeline/timelineLogic'
import { durationError } from '../../lib/schedule'

export interface ScheduleInput {
  startTime: string
  endTime: string
  duration: string
  basis: 'endTime' | 'duration'
}

// time入力は24:00を扱えないが、日付をまたがない予定の終了としては有効。
export function parseEndTime(value: string): number | null {
  return value === '24:00' ? 1440 : parseTime(value)
}

export function createScheduleInput(startTime: string, duration: string): ScheduleInput {
  return updateScheduleInput({ startTime: '', endTime: '', duration, basis: 'duration' }, 'startTime', startTime)
}

export function updateScheduleInput(
  current: ScheduleInput,
  field: 'startTime' | 'endTime' | 'duration',
  value: string,
): ScheduleInput {
  const next = { ...current, [field]: value }
  if (field !== 'startTime') next.basis = field
  const start = parseTime(next.startTime)
  if (field === 'startTime' && !value) {
    return { ...next, endTime: '', basis: 'duration' }
  }
  if (field === 'endTime' && !value && start === null) {
    return { ...next, basis: 'duration' }
  }
  if (next.basis === 'endTime') {
    const end = parseEndTime(next.endTime)
    next.duration = start === null ? current.duration : (end !== null && end > start ? String(end - start) : '')
  } else {
    const duration = Number(next.duration)
    const end = start === null ? null : start + duration
    next.endTime = end !== null && Number.isInteger(duration) && duration > 0 && end <= 1440
      ? formatMin(end) : ''
  }
  return next
}

export function scheduleInputError(input: ScheduleInput): string | null {
  if (input.basis === 'duration' || (!input.startTime && !input.endTime)) {
    if (!input.duration.trim()) return '所要時間を入力してください'
    const error = durationError(Number(input.duration))
    if (error) return error
  }
  if (!input.startTime && !input.endTime) return null
  const start = parseTime(input.startTime)
  if (start === null) return '開始時刻を正しく入力してください'
  if (input.basis === 'duration' && start + Number(input.duration) > 1440) return 'この所要時間では終了が24:00を超えます。日付をまたぐ予定は配置できません'
  const end = parseEndTime(input.endTime)
  if (end === null) return '終了時刻を正しく入力してください'
  if (end <= start) return '終了時刻は開始時刻より後にしてください'
  if (end - start < 5) return '所要時間は5分以上にしてください'
  return null
}
