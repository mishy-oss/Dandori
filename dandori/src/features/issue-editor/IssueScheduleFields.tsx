import { useId } from 'react'
import { DateField } from '../../app/DateField'
import { updateScheduleInput } from './scheduleInput'
import type { IssueEditorForm } from './useIssueEditorForm'
import { FIELD_CLASS as FIELD } from '../../app/fields'

type Props = Pick<IssueEditorForm,
  | 'issue'
  | 'date'
  | 'setDate'
  | 'setPlanningMonth'
  | 'calendarAllDay'
  | 'setCalendarAllDay'
  | 'setSchedule'
  | 'startTime'
  | 'endTime'
  | 'duration'
  | 'setStartTime'
  | 'setDuration'
>

export function IssueScheduleFields({
  issue, date, setDate, setPlanningMonth,
  calendarAllDay, setCalendarAllDay, setSchedule, startTime,
  endTime, duration, setStartTime, setDuration,
}: Props) {
  const scheduleHelpId = useId()
  return <>
    <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <legend className="px-1 text-sm font-semibold text-muted">スケジュール（タイムライン）</legend>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={calendarAllDay} onChange={event => { setCalendarAllDay(event.target.checked); if (!event.target.checked && duration === '1440') setDuration('30') }} />終日予定</label>
      {issue?.calendarReadOnly && <p className="text-xs text-muted">招待者のいるGoogleの予定です。ここでの変更はアプリ内だけに保存されます。</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="col-span-2 flex flex-col gap-1 text-sm text-muted sm:col-span-3">
          日付
          <DateField label="日付" className={FIELD} value={date} onChange={(value) => { setDate(value); if (value) setPlanningMonth(value.slice(0, 7)) }} />
        </div>
        <label className="flex flex-col gap-1 text-sm text-muted">
          開始時刻
          <input
            type="time"
            disabled={calendarAllDay}
            step={60}
            className={`${FIELD} min-w-0`}
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-sm text-muted">
          終了時刻
          <input
            type="time"
            disabled={calendarAllDay}
            step={60}
            className={`${FIELD} min-w-0`}
            aria-describedby={scheduleHelpId}
            value={calendarAllDay ? '' : endTime === '24:00' ? '00:00' : endTime}
            onChange={(event) => {
              // ネイティブの時刻入力では24:00を選べないため、終了の00:00を日の終わりとして扱う。
              const value = event.target.value === '00:00' ? '24:00' : event.target.value
              setSchedule(current => updateScheduleInput(current, 'endTime', value))
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          所要(分)
          <input
            type="number"
            disabled={calendarAllDay}
            inputMode="numeric"
            min={5}
            step={1}
            className={FIELD}
            value={calendarAllDay ? '1440' : duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </label>
      </div>
      <p id={scheduleHelpId} className="text-xs text-muted">終了時刻と所要時間は自動で連動します。終了の00:00は当日の24:00として扱います。</p>
      <button
        type="button"
        disabled={!startTime && !calendarAllDay}
        onClick={() => { setStartTime(''); setCalendarAllDay(false); if (duration === '1440') setDuration('30') }}
        className="min-h-11 rounded-lg border border-border text-sm disabled:opacity-40"
      >
        未配置に戻す(時刻をクリア)
      </button>
    </fieldset>
  </>
}
