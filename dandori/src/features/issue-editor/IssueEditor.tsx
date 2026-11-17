import { useMemo, useState, type FormEvent } from 'react'
import { ISSUE_TYPES, PRIORITIES, PRIORITY_LABELS, type Issue, type IssueType, type Priority, type RecurrenceFrequency } from '../../db/types'
import { formatIssueNumber } from '../../lib/issueNumber'
import { todayStr } from '../../lib/date'
import { currentMonth, isValidMonth, issueMonth } from '../../lib/month'
import { selectCurrentProject, useDataStore } from '../../store/data'
import { formatMin, parseTime } from '../timeline/timelineLogic'
import { appendIssueLabel, scheduledEditorStatusId } from './issueEditorLogic'
import { DeleteIssueDialog } from './DeleteIssueDialog'

const FIELD =
  'min-h-11 w-full rounded-lg border border-border bg-surface-2 px-3 text-base'
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

export function IssueEditor({
  issue,
  defaultStatusId,
  defaultPlanningMonth = currentMonth(),
  initialSchedule,
  onClose,
}: {
  issue: Issue | null
  defaultStatusId?: string
  defaultPlanningMonth?: string
  initialSchedule?: { date: string | null; startMin: number | null }
  onClose: () => void
}) {
  const project = useDataStore(selectCurrentProject)
  const workflow = useDataStore((s) => (project ? s.workflows[project.workflowId] : undefined))
  const defaultDuration = useDataStore((s) => s.settings.defaultDuration)
  const createIssue = useDataStore((s) => s.createIssue)
  const updateIssue = useDataStore((s) => s.updateIssue)
  const deleteIssue = useDataStore((s) => s.deleteIssue)
  const moveIssue = useDataStore((s) => s.moveIssue)
  const stopRecurrence = useDataStore((s) => s.stopRecurrence)
  const recurrenceRule = useDataStore((s) => s.recurrenceRules.find((rule) => rule.id === issue?.recurrenceId))
  const issues = useDataStore((s) => s.issues)
  // 並び順は同じステータス・同じ対象月の中で扱う。
  const column = useMemo(
    () =>
      issue
        ? issues.filter((i) => i.statusId === issue.statusId && issueMonth(i) === issueMonth(issue))
        : [],
    [issues, issue],
  )
  const position = issue ? column.findIndex((i) => i.id === issue.id) : -1

  const [title, setTitle] = useState(issue?.title ?? '')
  const [description, setDescription] = useState(issue?.description ?? '')
  const [labels, setLabels] = useState<string[]>(issue?.labels ?? [])
  const [labelDraft, setLabelDraft] = useState('')
  const [showDelete, setShowDelete] = useState(false)
  const [type, setType] = useState<IssueType>(issue?.type ?? 'task')
  const [priority, setPriority] = useState<Priority>(issue?.priority ?? 'medium')
  const [statusId, setStatusId] = useState(
    issue?.statusId ?? defaultStatusId ?? workflow?.statuses[0]?.id ?? '',
  )
  const [planningMonth, setPlanningMonth] = useState(issue ? issueMonth(issue) : initialSchedule?.date?.slice(0, 7) ?? defaultPlanningMonth)
  const [parentId, setParentId] = useState<string | null>(issue?.parentId ?? null)
  const [dueDate, setDueDate] = useState(issue?.dueDate ?? '')
  const [date, setDate] = useState(issue?.date ?? initialSchedule?.date ?? '')
  const startInit = issue ? issue.startMin : (initialSchedule?.startMin ?? null)
  const [startTime, setStartTime] = useState(startInit === null ? '' : formatMin(startInit))
  const [duration, setDuration] = useState(String(issue?.durationMin ?? defaultDuration))
  const [calendarAllDay, setCalendarAllDay] = useState(!!issue?.calendarAllDay)
  const [reminderOffsetMin, setReminderOffsetMin] = useState<number | null>(issue ? issue.reminderOffsetMin : 0)
  const [recurrence, setRecurrence] = useState<RecurrenceFrequency | ''>(recurrenceRule?.frequency ?? '')
  const [recurrenceInterval, setRecurrenceInterval] = useState(String(recurrenceRule?.interval ?? 1))
  const [recurrenceWeekdays, setRecurrenceWeekdays] = useState<number[]>(() =>
    recurrenceRule?.weekdays ?? [new Date(`${date || todayStr()}T00:00:00`).getDay()],
  )
  const [recurrenceEndDate, setRecurrenceEndDate] = useState(recurrenceRule?.endDate ?? '')
  const [error, setError] = useState<string | null>(null)
  const [childTitle, setChildTitle] = useState('')
  const [addingChild, setAddingChild] = useState(false)
  // 元の入力内容を失わないよう、関連タスクは別の編集画面で開く。
  const [relatedIssueId, setRelatedIssueId] = useState<string | null>(null)
  const relatedIssue = issues.find((item) => item.id === relatedIssueId)
  const issueId = issue?.id

  /* 親子関係の循環を防ぐため、自分と子孫は親候補に含めない。 */
  const descendants = useMemo(() => {
    const found = new Set<string>()
    if (!issueId) return found
    const parents = [issueId]
    while (parents.length) {
      const parent = parents.pop()!
      for (const child of issues) {
        if (child.parentId === parent && !found.has(child.id)) {
          found.add(child.id)
          parents.push(child.id)
        }
      }
    }
    return found
  }, [issues, issueId])
  const parentOptions = issues.filter((i) => i.id !== issueId && !descendants.has(i.id))
  const children = issueId ? issues.filter((i) => i.parentId === issueId) : []
  const isRoutine = workflow?.statuses.find((status) => status.id === statusId)?.category === 'routine'

  async function reorder(delta: -1 | 1) {
    if (!issue) return
    try {
      await moveIssue(issue.id, issue.statusId, position + delta, issueMonth(issue))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function run(action: () => Promise<unknown>) {
    try {
      await action()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function addChild() {
    if (!issue || !childTitle.trim() || addingChild) return
    setAddingChild(true)
    try {
      await createIssue({ title: childTitle, type: 'task', parentId: issue.id, planningMonth })
      setChildTitle('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setAddingChild(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!isValidMonth(planningMonth)) { setError('対象月を選択してください'); return }
    if (calendarAllDay && !date) { setError('終日予定の日付を指定してください'); return }
    const startMin = calendarAllDay ? null : startTime ? parseTime(startTime) : null
    if (!calendarAllDay && startTime && startMin === null) {
      setError('開始時刻が正しくありません')
      return
    }
    if (recurrence === 'weekly' && recurrenceWeekdays.length === 0) {
      setError('繰り返す曜日を1つ以上選択してください')
      return
    }
    const scheduleChanged = !issue || issue.date !== (date || null) || issue.startMin !== startMin
    const common = {
      labels: appendIssueLabel(labels, labelDraft),
      title,
      description: description || undefined,
      type,
      priority,
      statusId: scheduledEditorStatusId(workflow?.statuses ?? [], statusId, date || null, startMin, scheduleChanged),
      parentId,
      dueDate: dueDate || null,
      date: date || null,
      startMin,
      durationMin: calendarAllDay ? 1440 : Number(duration),
      calendarAllDay,
      reminderOffsetMin,
      planningMonth,
      sprintId: null,
    }
    void run(async () => {
      if (!issue) {
        await createIssue({
          ...common,
          ...(recurrence && {
            recurrence: {
              frequency: recurrence,
              interval: Number(recurrenceInterval),
              ...(recurrence === 'weekly' && { weekdays: recurrenceWeekdays }),
              endDate: recurrenceEndDate || null,
            },
          }),
        })
        return
      }
      await updateIssue(issue.id, {
        ...common,
        recurrence: recurrence
          ? {
              frequency: recurrence,
              interval: Number(recurrenceInterval),
              ...(recurrence === 'weekly' && { weekdays: recurrenceWeekdays }),
              endDate: recurrenceEndDate || null,
            }
          : null,
      })
    })
  }

  return (
    <><div className={`${relatedIssue ? 'hidden' : 'flex'} fixed inset-0 z-40 items-end bg-black/50`} onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={issue ? 'Issueを編集' : 'Issueを作成'}
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="mx-auto flex max-h-[90%] w-full max-w-xl flex-col gap-3 overflow-y-auto rounded-t-2xl bg-surface p-4"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
      >
        <h2 className="text-lg font-bold">
          {issue ? formatIssueNumber(issue.number) : '新規タスク'}
        </h2>



        <label className="flex flex-col gap-1 text-sm text-muted">
          タイトル
          <input
            className={FIELD}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus={!issue}
          />
        </label>

        <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-semibold text-muted">ラベル</legend>
          <div className="flex gap-2">
            <input aria-label="追加するラベル" className={`${FIELD} min-w-0 flex-1`} value={labelDraft} placeholder="仕事・買い物など"
              onChange={(event) => setLabelDraft(event.target.value)}
              onKeyDown={(event) => {
                // IMEの変換確定をラベル追加として扱わない。
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  setLabels(appendIssueLabel(labels, labelDraft))
                  setLabelDraft('')
                }
              }} />
            <button type="button" disabled={!labelDraft.trim()} className="min-h-11 rounded-lg border border-border px-3 text-sm disabled:opacity-40"
              onClick={() => { setLabels(appendIssueLabel(labels, labelDraft)); setLabelDraft('') }}>追加</button>
          </div>
          {labels.length > 0 && <ul className="flex flex-wrap gap-2">
            {labels.map((label, index) => <li key={`${index}-${label}`} className="flex max-w-full items-center gap-1 rounded-lg bg-surface-2 pl-3 text-sm">
              <span className="break-words">{label}</span>
              <button type="button" aria-label={`${label}のラベルを削除`} className="min-h-11 min-w-11 shrink-0"
                onClick={() => setLabels(labels.filter((_, labelIndex) => labelIndex !== index))}>×</button>
            </li>)}
          </ul>}
        </fieldset>

        <fieldset disabled={!!issue?.calendarSeriesId} className="flex flex-col gap-2 rounded-lg border border-border p-3">
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
                <label className="col-span-2 flex flex-col gap-1 text-sm text-muted">
                  繰り返し終了日（任意）
                  <input
                    type="date"
                    className={FIELD}
                    min={date || undefined}
                    value={recurrenceEndDate}
                    onChange={(e) => setRecurrenceEndDate(e.target.value)}
                  />
                </label>
              )}
            </div>
            {recurrence && (
              <p className="text-xs text-muted">対象月内の繰り返し予定を自動で作成します。月を切り替えると、その月の予定も準備します。</p>
            )}
            {recurrence === 'monthly' && (
              <p className="text-xs text-muted">開始日と同じ日にちで繰り返します。その日がない月は月末になります。</p>
            )}
            {issue && recurrenceRule?.active && (
              <button
                type="button"
                className="min-h-11 rounded-lg border border-border px-3 text-sm"
                onClick={() => void run(() => stopRecurrence(recurrenceRule.id))}
              >
                この繰り返しを停止
              </button>
            )}
          </fieldset>

        <label className="flex flex-col gap-1 text-sm text-muted">
          説明
          <textarea
            className={`${FIELD} min-h-24 py-2`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

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
          <label className="flex flex-col gap-1 text-sm text-muted">
            親Issue / Epic
            <select className={FIELD} value={parentId ?? ''} onChange={(e) => setParentId(e.target.value || null)}>
              <option value="">なし</option>
              {parentOptions.map((parent) => (
                <option key={parent.id} value={parent.id}>
                  {parent.type === 'epic' ? 'Epic' : parent.type} · {formatIssueNumber(parent.number)} · {parent.title}
                </option>
              ))}
            </select>
            {parentId && <button type="button" className="min-h-11 text-left text-xs text-accent"
              onClick={() => setRelatedIssueId(parentId)}>親タスクを編集</button>}
          </label>
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
          <label className="flex flex-col gap-1 text-sm text-muted">
            期限
            <input
              type="date"
              className={FIELD}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>
        </div>

        <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-semibold text-muted">スケジュール（タイムライン）</legend>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={calendarAllDay} onChange={event => { setCalendarAllDay(event.target.checked); if (!event.target.checked && duration === '1440') setDuration('30') }} />終日予定</label>
          {issue?.calendarReadOnly && <p className="text-xs text-muted">招待者のいるGoogleの予定です。ここでの変更はアプリ内だけに保存されます。</p>}
          <div className="grid grid-cols-3 gap-2">
            <label className="col-span-3 flex flex-col gap-1 text-sm text-muted sm:col-span-1">
              日付
              <input type="date" className={FIELD} value={date} onChange={(e) => { setDate(e.target.value); if (e.target.value) setPlanningMonth(e.target.value.slice(0, 7)) }} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-muted">
              開始時刻
              <input
                type="time"
                disabled={calendarAllDay}
                step={issue?.calendarSource ? 60 : 300}
                className={FIELD}
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-muted">
              所要(分)
              <input
                type="number"
                disabled={calendarAllDay}
                inputMode="numeric"
                min={5}
                step={issue?.calendarSource ? 1 : 5}
                className={FIELD}
                value={calendarAllDay ? '1440' : duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </label>
          </div>
          <button
            type="button"
            disabled={!startTime && !calendarAllDay}
            onClick={() => { setStartTime(''); setCalendarAllDay(false); if (duration === '1440') setDuration('30') }}
            className="min-h-11 rounded-lg border border-border text-sm disabled:opacity-40"
          >
            未配置に戻す(時刻をクリア)
          </button>
        </fieldset>

        {isRoutine && <p className="text-xs text-muted">Recurring：会議など決まった時間の予定に使います。日付・開始時刻と、必要に応じて繰り返しを設定してください。</p>}
        {issue && (
          <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-semibold text-muted">
              子タスク ({children.length})
            </legend>
            {children.length > 0 && <p className="text-xs text-muted">親のステータスは子タスクの進捗に連動します。子タスクを押すと編集できます。</p>}
            {children.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {children.map((child) => (
                  <li key={child.id} className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                    <span className="shrink-0 text-xs text-muted">{child.type === 'epic' ? 'Epic' : child.type} · {formatIssueNumber(child.number)}</span>
                    <button type="button" aria-label={`${child.title}を編集`} className="min-h-11 min-w-0 flex-1 truncate text-left text-accent"
                      onClick={() => setRelatedIssueId(child.id)}>{child.title}</button>
                    <span className="shrink-0 text-xs text-muted">{workflow?.statuses.find((s) => s.id === child.statusId)?.name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">子Issueはまだありません</p>
            )}
            <div className="flex gap-2">
              <input
                aria-label="子Issueのタイトル"
                className={`${FIELD} min-w-0 flex-1`}
                placeholder="サブタスクを追加"
                value={childTitle}
                onChange={(e) => setChildTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void addChild()
                  }
                }}
              />
              <button
                type="button"
                disabled={!childTitle.trim() || addingChild}
                onClick={() => void addChild()}
                className="min-h-11 shrink-0 rounded-lg border border-border px-3 text-sm disabled:opacity-40"
              >
                追加
              </button>
            </div>
          </fieldset>
        )}

        {issue && column.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="flex-1 text-sm text-muted">
              列内の並び順({position + 1}/{column.length})
            </span>
            <button
              type="button"
              aria-label="列内で上へ移動"
              disabled={position <= 0}
              onClick={() => void reorder(-1)}
              className="min-h-11 min-w-11 rounded-lg border border-border disabled:opacity-40"
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="列内で下へ移動"
              disabled={position < 0 || position >= column.length - 1}
              onClick={() => void reorder(1)}
              className="min-h-11 min-w-11 rounded-lg border border-border disabled:opacity-40"
            >
              ↓
            </button>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-500">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          {issue && (
            <button
              type="button"
              className="min-h-11 rounded-lg border border-red-500 px-4 text-sm text-red-500"
              onClick={() => setShowDelete(true)}
            >
              削除
            </button>
          )}
          <button
            type="button"
            className="min-h-11 flex-1 rounded-lg border border-border px-4 text-sm"
            onClick={onClose}
          >
            キャンセル
          </button>
          <button
            type="submit"
            className="min-h-11 flex-1 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-text"
          >
            保存
          </button>
        </div>
      </form>
    </div>
    {showDelete && issue && <DeleteIssueDialog title={issue.title} descendantCount={descendants.size}
      onDelete={() => deleteIssue(issue.id)}
      onClose={() => setShowDelete(false)}
      onDeleted={onClose} />}
    {relatedIssue && <IssueEditor key={relatedIssue.id} issue={relatedIssue}
      onClose={() => setRelatedIssueId(null)} />}
    </>
  )
}
