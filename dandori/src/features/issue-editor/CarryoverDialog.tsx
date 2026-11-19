import { useId, useState, type FormEvent } from 'react'
import type { Issue } from '../../db/types'
import { addDaysStr, todayStr } from '../../lib/date'
import { useDataStore } from '../../store/data'
import { formatMin, parseTime } from '../timeline/timelineLogic'
import { createScheduleInput, scheduleInputError, updateScheduleInput } from './scheduleInput'

const FIELD = 'min-h-11 w-full min-w-0 rounded-lg border border-border bg-surface-2 px-3 text-base'

export function CarryoverDialog({ issue, targetDate, onClose, onCreated }: {
  issue: Issue; targetDate?: string; onClose: () => void; onCreated: (issue: Issue) => void
}) {
  const carryover = useDataStore(state => state.carryoverIssue)
  const [date, setDate] = useState(targetDate ?? [addDaysStr(issue.date!, 1), todayStr()].sort().at(-1)!)
  const [schedule, setSchedule] = useState(() => createScheduleInput(issue.startMin === null ? '' : formatMin(issue.startMin), String(issue.durationMin)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleId = useId()

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const validation = issue.calendarAllDay ? null : scheduleInputError(schedule)
    if (validation) { setError(validation); return }
    setBusy(true)
    setError(null)
    try {
      const next = await carryover(issue.id, { date, startMin: issue.calendarAllDay ? null : parseTime(schedule.startTime), durationMin: issue.calendarAllDay ? 1440 : Number(schedule.duration) })
      onCreated(next)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false) }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { if (!busy) onClose() }}>
    <form role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={event => void submit(event)} onClick={event => event.stopPropagation()}
      className="flex max-h-[90%] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-2xl bg-surface p-4">
      <h2 id={titleId} className="font-semibold">未完了タスクを持ち越す</h2>
      <p className="break-words text-sm">{issue.title}</p>
      <p className="text-xs text-muted">元の配置は未完了の履歴として残します。未完了の子タスクも引き継ぎ、子タスクの時刻は持ち越し先で設定できます。</p>
      <fieldset disabled={busy} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">持ち越し先の日付<input required type="date" min={addDaysStr(issue.date!, 1)} className={FIELD} value={date} onChange={event => setDate(event.target.value)} /></label>
        {issue.calendarAllDay ? <p className="text-sm">終日予定として引き継ぎます。</p> : <div className="grid grid-cols-2 gap-2">
          <label className="flex min-w-0 flex-col gap-1 text-sm">開始時刻<input type="time" step={60} className={FIELD} value={schedule.startTime} onChange={event => setSchedule(current => updateScheduleInput(current, 'startTime', event.target.value))} /></label>
          <label className="flex min-w-0 flex-col gap-1 text-sm">終了時刻<input type="time" step={60} className={FIELD} value={schedule.endTime === '24:00' ? '00:00' : schedule.endTime} onChange={event => setSchedule(current => updateScheduleInput(current, 'endTime', event.target.value === '00:00' ? '24:00' : event.target.value))} /></label>
          <label className="col-span-2 flex flex-col gap-1 text-sm">所要(分)<input required type="number" min={5} max={1440} step={1} className={FIELD} value={schedule.duration} onChange={event => setSchedule(current => updateScheduleInput(current, 'duration', event.target.value))} /></label>
          <p className="col-span-2 text-xs text-muted">時刻を空にすると未配置で引き継ぎます。終了の00:00は当日の24:00です。</p>
        </div>}
      </fieldset>
      {(issue.recurrenceId || issue.calendarSeriesId) && <p className="text-xs text-muted">この回だけを引き継ぎます。持ち越し先に繰り返しルールは複製しません。</p>}
      <p className="text-xs text-muted">Google連携中は、持ち越し先に配置した予定を別の予定として同期します。元のGoogle予定は移動しません。</p>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <div className="flex gap-2"><button type="button" disabled={busy} onClick={onClose} className="min-h-11 flex-1 rounded-lg border border-border">キャンセル</button>
        <button type="submit" disabled={busy} className="min-h-11 flex-1 rounded-lg bg-accent text-accent-text disabled:opacity-40">{busy ? '保存中…' : '持ち越す'}</button></div>
    </form>
  </div>
}
