import type { ReactNode } from 'react'
import { ISSUE_TYPES, PRIORITIES, PRIORITY_LABELS, type IssueType, type Priority } from '../../db/types'
import { DateField } from '../../app/DateField'
import type { IssueEditorForm } from './useIssueEditorForm'
import { FIELD_CLASS as FIELD } from '../../app/fields'

type Props = Pick<IssueEditorForm,
  | 'type'
  | 'setType'
  | 'priority'
  | 'setPriority'
  | 'statusId'
  | 'setStatusId'
  | 'workflow'
  | 'planningMonth'
  | 'setPlanningMonth'
  | 'date'
  | 'setDate'
  | 'setStartTime'
  | 'reminderOffsetMin'
  | 'setReminderOffsetMin'
  | 'dueDate'
  | 'setDueDate'
> & { parentField: ReactNode }

export function IssueMetadataFields({
  type, setType, priority, setPriority,
  statusId, setStatusId, workflow, planningMonth,
  setPlanningMonth, date, setDate, setStartTime,
  reminderOffsetMin, setReminderOffsetMin, dueDate, setDueDate,
  parentField,
}: Props) {
  return <>
    <div className="grid grid-cols-2 gap-3">
      <label className="flex flex-col gap-1 text-sm text-muted">
        種別
        <select className={FIELD} value={type} onChange={(e) => setType(e.target.value as IssueType)}>
          {ISSUE_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-muted">
        優先度
        <select
          className={FIELD}
          value={priority}
          onChange={(e) => setPriority(e.target.value as Priority)}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-muted">
        ステータス
        <select className={FIELD} value={statusId} onChange={(e) => setStatusId(e.target.value)}>
          {workflow?.statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-muted">
        対象月
        <input type="month" className={FIELD} value={planningMonth}
          onChange={(event) => {
            const month = event.target.value
            setPlanningMonth(month)
            if (date && date.slice(0, 7) !== month) { setDate(''); setStartTime('') }
          }} />
      </label>
      {parentField}
      <label className="col-span-2 flex flex-col gap-1 text-sm text-muted">
        通知
        <select
          className={FIELD}
          value={reminderOffsetMin === null ? 'none' : String(reminderOffsetMin)}
          onChange={(e) => setReminderOffsetMin(e.target.value === 'none' ? null : Number(e.target.value))}
        >
          <option value="none">通知しない</option>
          <option value="0">予定時刻</option>
          <option value="5">5分前</option>
          <option value="15">15分前</option>
          <option value="30">30分前</option>
          <option value="60">1時間前</option>
        </select>
        <span className="text-xs">日付と開始時刻があるIssueに通知します。受信には設定画面でPWA通知を有効にしてください。</span>
      </label>
      <div className="flex flex-col gap-1 text-sm text-muted">
        期限
        <DateField
          label="期限"
          className={FIELD}
          value={dueDate}
          onChange={setDueDate}
        />
      </div>
    </div>
  </>
}
