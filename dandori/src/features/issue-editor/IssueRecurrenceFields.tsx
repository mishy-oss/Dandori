import { useId } from 'react'
import type { RecurrenceFrequency } from '../../db/types'
import { DateField } from '../../app/DateField'
import type { IssueEditorForm } from './useIssueEditorForm'
import { FIELD_CLASS as FIELD } from '../../app/fields'

type Props = Pick<IssueEditorForm,
  | 'issue'
  | 'workflow'
  | 'editScope'
  | 'setEditScope'
  | 'recurrence'
  | 'setRecurrence'
  | 'recurrenceInterval'
  | 'setRecurrenceInterval'
  | 'recurrenceWeekdays'
  | 'setRecurrenceWeekdays'
  | 'recurrenceEndDate'
  | 'setRecurrenceEndDate'
  | 'date'
  | 'recurrenceRule'
>

export function IssueRecurrenceFields({
  issue, workflow, editScope, setEditScope,
  recurrence, setRecurrence, recurrenceInterval, setRecurrenceInterval,
  recurrenceWeekdays, setRecurrenceWeekdays, recurrenceEndDate, setRecurrenceEndDate,
  date, recurrenceRule,
}: Props) {
  const scheduleHelpId = useId()
  const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']
  return <>
    {issue?.recurrenceId && <fieldset className="flex flex-col gap-2 rounded-lg border border-accent/30 p-3">
      <legend className="px-1 text-sm font-semibold">変更する範囲</legend>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" name={`edit-scope-${scheduleHelpId}`} checked={editScope === 'single'} onChange={() => setEditScope('single')} />この回のみ</label>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" name={`edit-scope-${scheduleHelpId}`} checked={editScope === 'future'} disabled={workflow?.statuses.some(status => status.id === issue.statusId && status.category === 'done')}
        onChange={() => setEditScope('future')} />この回以降</label>
      <p className="text-xs text-muted">「この回以降」は変更した内容を後の未完了分と今後の生成に反映します。ステータス・親子関係・対象月はこの回だけに反映します。完了済みの回と持ち越し履歴は変更しません。</p>
    </fieldset>}
    <fieldset disabled={!!issue?.calendarSeriesId || (!!issue?.recurrenceId && editScope === 'single')} className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-semibold text-muted">繰り返し</legend>
        {issue?.calendarSeriesId && <p className="text-xs text-muted">Googleカレンダーの繰り返し予定です。曜日などのルールはGoogle側で変更してください。ここでは1回分を編集します。</p>}
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-sm text-muted">
            頻度
            <select
              className={FIELD}
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value as RecurrenceFrequency | '')}
            >
              <option value="">繰り返さない</option>
              <option value="daily">毎日</option>
              <option value="weekly">毎週</option>
              <option value="monthly">毎月</option>
            </select>
          </label>
          {recurrence && (
            <label className="flex flex-col gap-1 text-sm text-muted">
              間隔
              <span className="flex min-h-11 items-center gap-2">
                <span>毎</span>
                <input
                  type="number"
                  className={`${FIELD} w-20`}
                  min={1}
                  max={365}
                  value={recurrenceInterval}
                  onChange={(e) => setRecurrenceInterval(e.target.value)}
                />
                <span>{recurrence === 'daily' ? '日' : recurrence === 'weekly' ? '週' : 'か月'}</span>
              </span>
            </label>
          )}
          {recurrence === 'weekly' && (
            <div className="col-span-2 flex flex-col gap-1 text-sm text-muted">
              <span>曜日（複数選択可）</span>
              <div className="grid grid-cols-7 gap-1" role="group" aria-label="繰り返す曜日">
                {WEEKDAY_LABELS.map((label, weekday) => {
                  const selected = recurrenceWeekdays.includes(weekday)
                  return (
                    <button
                      key={weekday}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        setRecurrenceWeekdays((current) =>
                          selected
                            ? current.filter((day) => day !== weekday)
                            : [...current, weekday].sort((a, b) => a - b),
                        )
                      }
                      className={`min-h-11 rounded-lg border text-sm ${selected ? 'border-accent bg-accent text-accent-text' : 'border-border bg-surface-2'}`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          {recurrence && (
            <div className="col-span-2 flex flex-col gap-1 text-sm text-muted">
              繰り返し終了日（任意）
              <DateField
                label="繰り返し終了日"
                className={FIELD}
                min={date || undefined}
                value={recurrenceEndDate}
                onChange={setRecurrenceEndDate}
              />
            </div>
          )}
        </div>
        {recurrence && (
          <p className="text-xs text-muted">対象月内の繰り返し予定を自動で作成します。月を切り替えると、その月の予定も準備します。</p>
        )}
        {recurrence === 'monthly' && (
          <p className="text-xs text-muted">開始日と同じ日にちで繰り返します。その日がない月は月末になります。</p>
        )}
      </fieldset>
    {issue?.recurrenceId && <p className="text-xs text-muted">頻度・曜日・終了日を変える場合は「この回以降」を選択してください。「繰り返さない」でこの回を単発にし、後の未完了分を取り消せます。曜日変更時はこの回も指定日以降の最初の該当日に配置します。</p>}
    {recurrenceRule && !recurrenceRule.active && <p className="text-xs text-muted">この繰り返しは停止中です。保存しても再開しません。</p>}
  </>
}
