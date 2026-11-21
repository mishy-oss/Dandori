import { useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { ISSUE_TYPES, PRIORITIES, PRIORITY_LABELS, type Issue, type IssueType, type Priority, type RecurrenceFrequency } from '../../db/types'
import { formatIssueNumber } from '../../lib/issueNumber'
import { todayStr } from '../../lib/date'
import { currentMonth, isValidMonth, issueMonth } from '../../lib/month'
import { selectCurrentProject, useDataStore } from '../../store/data'
import { formatMin, parseTime } from '../timeline/timelineLogic'
import { appendIssueLabel, scheduledEditorStatusId } from './issueEditorLogic'
import { DeleteIssueDialog } from './DeleteIssueDialog'
import { CarryoverDialog } from './CarryoverDialog'
import { currentWork } from '../../lib/carryover'
import { createScheduleInput, scheduleInputError, updateScheduleInput } from './scheduleInput'
import type { RecurringEditScope } from '../../db/recurringEditRepo'
import { existingIssueLabels, labelKey, normalizeIssueLabels, normalizeLabel, suggestIssueLabels } from '../../lib/labels'

const FIELD =
  'min-h-11 w-full rounded-lg border border-border bg-surface-2 px-3 text-base'
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

export function IssueEditor({
  issue: initialIssue,
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
  const issue = useDataStore(state => initialIssue ? state.issues.find(item => item.id === initialIssue.id) ?? initialIssue : null)
  const project = useDataStore(selectCurrentProject)
  const scheduleHelpId = useId()
  const workflow = useDataStore((s) => (project ? s.workflows[project.workflowId] : undefined))
  const defaultDuration = useDataStore((s) => s.settings.defaultDuration)
  const createIssue = useDataStore((s) => s.createIssue)
  const updateIssue = useDataStore((s) => s.updateIssue)
  const deleteIssue = useDataStore((s) => s.deleteIssue)
  const moveIssue = useDataStore((s) => s.moveIssue)
  const recurrenceRule = useDataStore((s) => s.recurrenceRules.find((rule) => rule.id === issue?.recurrenceId))
  const issues = useDataStore((s) => s.issues)
  // 並び順は同じステータス・同じ対象月の中で扱う。
  const column = useMemo(
    () =>
      issue
        ? currentWork(issues).filter((i) => i.statusId === issue.statusId && issueMonth(i) === issueMonth(issue))
        : [],
    [issues, issue],
  )
  const position = issue ? column.findIndex((i) => i.id === issue.id) : -1

  const [title, setTitle] = useState(issue?.title ?? '')
  const [description, setDescription] = useState(issue?.description ?? '')
  const [labels, setLabels] = useState<string[]>(issue?.labels ?? [])
  const [labelDraft, setLabelDraft] = useState('')
  const labelInputRef = useRef<HTMLInputElement>(null)
  const labelHelpId = useId()
  const knownLabels = useMemo(() => existingIssueLabels(issues, project?.id ?? ''), [issues, project?.id])
  const selectedLabels = normalizeIssueLabels(labels, knownLabels)
  const labelSuggestions = suggestIssueLabels(knownLabels, selectedLabels, labelDraft)
  const [showDelete, setShowDelete] = useState(false)
  const [showCarryover, setShowCarryover] = useState(false)
  const [type, setType] = useState<IssueType>(issue?.type ?? 'task')
  const [priority, setPriority] = useState<Priority>(issue?.priority ?? 'medium')
  const [statusId, setStatusId] = useState(
    issue?.statusId ?? defaultStatusId ?? workflow?.statuses[0]?.id ?? '',
  )
  const [planningMonth, setPlanningMonth] = useState(issue ? issueMonth(issue) : initialSchedule?.date?.slice(0, 7) ?? defaultPlanningMonth)
  const savedParentId = issue?.parentId ?? null
  const [parentDraft, setParentDraft] = useState({ saved: savedParentId, value: savedParentId })
  // 関連画面から親子関係を外した後、古いフォームの保存で再接続しない。
  const parentId = parentDraft.saved === savedParentId ? parentDraft.value : savedParentId
  const setParentId = (value: string | null) => setParentDraft({ saved: savedParentId, value })
  const [dueDate, setDueDate] = useState(issue?.dueDate ?? '')
  const [date, setDate] = useState(issue?.date ?? initialSchedule?.date ?? '')
  const startInit = issue ? issue.startMin : (initialSchedule?.startMin ?? null)
  const [schedule, setSchedule] = useState(() => createScheduleInput(
    startInit === null ? '' : formatMin(startInit), String(issue?.durationMin ?? defaultDuration),
  ))
  const { startTime, endTime, duration } = schedule
  const setStartTime = (value: string) => setSchedule(current => updateScheduleInput(current, 'startTime', value))
  const setDuration = (value: string) => setSchedule(current => updateScheduleInput(current, 'duration', value))
  const [calendarAllDay, setCalendarAllDay] = useState(!!issue?.calendarAllDay)
  const [reminderOffsetMin, setReminderOffsetMin] = useState<number | null>(issue ? issue.reminderOffsetMin : 0)
  const [recurrence, setRecurrence] = useState<RecurrenceFrequency | ''>(recurrenceRule?.frequency ?? '')
  const [recurrenceInterval, setRecurrenceInterval] = useState(String(recurrenceRule?.interval ?? 1))
  const [recurrenceWeekdays, setRecurrenceWeekdays] = useState<number[]>(() =>
    recurrenceRule?.weekdays ?? [new Date(`${date || todayStr()}T00:00:00`).getDay()],
  )
  const [recurrenceEndDate, setRecurrenceEndDate] = useState(recurrenceRule?.endDate ?? '')
  const [editScope, setEditScope] = useState<RecurringEditScope>('single')
  const [error, setError] = useState<string | null>(null)
  const [childTitle, setChildTitle] = useState('')
  const [addingChild, setAddingChild] = useState(false)
  const [detachingId, setDetachingId] = useState<string | null>(null)
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
  const parentOptions = currentWork(issues).filter((i) => i.id !== issueId && !descendants.has(i.id))
  const children = issueId ? currentWork(issues).filter((i) => i.parentId === issueId) : []
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

  async function detachParent(child: Issue) {
    if (detachingId) return
    setDetachingId(child.id)
    setError(null)
    try {
      await updateIssue(child.id, { parentId: null })
      if (child.id === issueId) setParentDraft({ saved: null, value: null })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setDetachingId(null)
    }
  }

  function addLabel(value: string) {
    setLabels(appendIssueLabel(selectedLabels, value, knownLabels))
    setLabelDraft('')
    labelInputRef.current?.focus()
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (detachingId) return
    if (!isValidMonth(planningMonth)) { setError('対象月を選択してください'); return }
    if (calendarAllDay && !date) { setError('終日予定の日付を指定してください'); return }
    const timeError = calendarAllDay ? null : scheduleInputError(schedule)
    if (timeError) { setError(timeError); return }
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
      labels: appendIssueLabel(selectedLabels, labelDraft, knownLabels),
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
      }, issue.recurrenceId ? editScope : undefined)
    })
  }

  if (issue?.carryoverToId) {
    const destination = issues.find(item => item.id === issue.carryoverToId)
    return <>
      <div className={`${relatedIssue ? 'hidden' : 'flex'} fixed inset-0 z-40 items-end bg-black/50`} onClick={onClose}>
        <section role="dialog" aria-modal="true" aria-label="持ち越し前の配置履歴" onClick={event => event.stopPropagation()} className="mx-auto flex max-h-[90%] w-full max-w-xl flex-col gap-3 overflow-y-auto rounded-t-2xl bg-surface p-4 pb-8">
          <h2 className="font-bold">{formatIssueNumber(issue.number)} · 配置履歴</h2>
          <p className="font-semibold">{issue.title}</p>
          <p className="text-sm">{issue.date} · {issue.calendarAllDay ? '終日' : issue.startMin === null ? '未配置' : `${formatMin(issue.startMin)}〜${formatMin(issue.startMin + issue.durationMin)}`}</p>
          <p className="text-sm text-muted">未完了 · {destination?.date ?? '後日'}へ持ち越し済み</p>
          <p className="text-xs text-muted">当日の記録を残すため、履歴の変更・削除・完了操作はできません。残タスク数には持ち越し先だけを数えます。</p>
          {issue.description && <p className="whitespace-pre-wrap break-words text-sm">{issue.description}</p>}
          {issue.labels.length > 0 && <p className="text-xs text-muted">ラベル：{issue.labels.join('、')}</p>}
          {destination ? <button type="button" className="min-h-11 rounded-lg bg-accent text-accent-text" onClick={() => setRelatedIssueId(destination.id)}>持ち越し先を開く</button> : <p className="text-xs text-muted">持ち越し先は削除されています。</p>}
          <button type="button" className="min-h-11 rounded-lg border border-border" onClick={onClose}>閉じる</button>
        </section>
      </div>
      {relatedIssue && <IssueEditor key={relatedIssue.id} issue={relatedIssue} onClose={onClose} />}
    </>
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
        {issue?.carryoverFromId && <p className="text-xs text-muted">{issues.find(item => item.id === issue.carryoverFromId)?.date ?? '過去の予定'}から持ち越し</p>}
        {issue?.date && !workflow?.statuses.some(status => status.id === issue.statusId && status.category === 'done') && <>
          <button type="button" className="min-h-11 rounded-lg border border-accent px-3 text-sm text-accent" onClick={() => setShowCarryover(true)}>翌日以降へ持ち越す</button>
          <p className="text-xs text-muted">持ち越しは保存済みの内容を引き継ぎます。編集中の変更は先に保存してください。</p>
        </>}



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
            <input ref={labelInputRef} aria-label="追加するラベル" aria-describedby={labelHelpId} autoComplete="off" className={`${FIELD} min-w-0 flex-1`} value={labelDraft} placeholder="既存のラベルを選択、または新しく入力"
              onChange={(event) => setLabelDraft(event.target.value)}
              onKeyDown={(event) => {
                // IMEの変換確定をラベル追加として扱わない。
                if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                  event.preventDefault()
                  addLabel(labelDraft)
                }
              }} />
            <button type="button" disabled={!normalizeLabel(labelDraft)} className="min-h-11 rounded-lg border border-border px-3 text-sm disabled:opacity-40"
              onClick={() => addLabel(labelDraft)}>追加</button>
          </div>
          <p id={labelHelpId} className="text-[11px] text-muted">候補を押すと追加できます。前後・連続する空白、全角・半角、英字の大小文字の違いは同じラベルとして扱います。</p>
          {labelSuggestions.length > 0 ? <div>
            <p className="mb-1 text-xs text-muted">既存のラベルから選択</p>
            <ul aria-label="ラベルの候補" className="flex max-h-36 flex-wrap gap-2 overflow-y-auto">
              {labelSuggestions.map(label => <li key={labelKey(label)} className="max-w-full">
                <button type="button" aria-label={`${label}のラベルを追加`} className="min-h-11 max-w-full break-words rounded-lg border border-border px-3 text-left text-sm text-accent" onClick={() => addLabel(label)}>{label}</button>
              </li>)}
            </ul>
          </div> : labelDraft && <p role="status" className="text-xs text-muted">{selectedLabels.some(label => labelKey(label) === labelKey(labelDraft)) ? 'このラベルは追加済みです。' : '一致する候補がありません。「追加」で新しいラベルを作成できます。'}</p>}
          {selectedLabels.length > 0 && <ul aria-label="追加済みのラベル" className="flex flex-wrap gap-2">
            {selectedLabels.map((label) => <li key={labelKey(label)} className="flex max-w-full items-center gap-1 rounded-lg bg-surface-2 pl-3 text-sm">
              <span className="break-words">{label}</span>
              <button type="button" aria-label={`${label}のラベルを削除`} className="min-h-11 min-w-11 shrink-0"
                onClick={() => setLabels(selectedLabels.filter(selected => labelKey(selected) !== labelKey(label)))}>×</button>
            </li>)}
          </ul>}
        </fieldset>

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
          </fieldset>
        {issue?.recurrenceId && <p className="text-xs text-muted">頻度・曜日・終了日を変える場合は「この回以降」を選択してください。「繰り返さない」でこの回を単発にし、後の未完了分を取り消せます。曜日変更時はこの回も指定日以降の最初の該当日に配置します。</p>}
        {recurrenceRule && !recurrenceRule.active && <p className="text-xs text-muted">この繰り返しは停止中です。保存しても再開しません。</p>}

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
            <select className={FIELD} disabled={detachingId !== null} value={parentId ?? ''} onChange={(e) => setParentId(e.target.value || null)}>
              <option value="">なし</option>
              {parentOptions.map((parent) => (
                <option key={parent.id} value={parent.id}>
                  {parent.type === 'epic' ? 'Epic' : parent.type} · {formatIssueNumber(parent.number)} · {parent.title}
                </option>
              ))}
            </select>
            {parentId && <>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={detachingId !== null} className="min-h-11 text-left text-xs text-accent disabled:opacity-40"
                  onClick={() => setRelatedIssueId(parentId)}>親タスクを編集</button>
                <button type="button" disabled={detachingId !== null} className="min-h-11 rounded-lg border border-border px-3 text-xs disabled:opacity-40"
                  onClick={() => { if (issue?.parentId) void detachParent(issue); else setParentId(null) }}>{detachingId === issueId ? '解除中…' : '親を外す'}</button>
              </div>
              <span className="text-xs">{issue?.parentId ? 'タスクは残し、親子関係だけを外します。解除はすぐに保存されます。' : '親の選択を解除します。'}</span>
            </>}
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
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <label className="col-span-2 flex flex-col gap-1 text-sm text-muted sm:col-span-3">
              日付
              <input type="date" className={FIELD} value={date} onChange={(e) => { setDate(e.target.value); if (e.target.value) setPlanningMonth(e.target.value.slice(0, 7)) }} />
            </label>
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

        {isRoutine && <p className="text-xs text-muted">Recurring：会議など決まった時間の予定に使います。日付・開始時刻と、必要に応じて繰り返しを設定してください。</p>}
        {issue && (
          <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-semibold text-muted">
              子タスク ({children.length})
            </legend>
            {children.length > 0 && <p className="text-xs text-muted">親のステータスは子タスクの進捗に連動します。子タスクを押すと編集できます。「外す」はタスクを残して親子関係だけを解除し、すぐに保存します。</p>}
            {children.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {children.map((child) => (
                  <li key={child.id} className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                    <span className="shrink-0 text-xs text-muted">{child.type === 'epic' ? 'Epic' : child.type} · {formatIssueNumber(child.number)}</span>
                    <button type="button" aria-label={`${child.title}を編集`} disabled={detachingId !== null} className="min-h-11 min-w-0 flex-1 truncate text-left text-accent disabled:opacity-40"
                      onClick={() => setRelatedIssueId(child.id)}>{child.title}</button>
                    <span className="shrink-0 text-xs text-muted">{workflow?.statuses.find((s) => s.id === child.statusId)?.name}</span>
                    <button type="button" aria-label={`${child.title}を親タスクから外す`} disabled={detachingId !== null}
                      className="min-h-11 min-w-11 shrink-0 rounded-lg border border-border px-2 text-xs disabled:opacity-40"
                      onClick={() => void detachParent(child)}>{detachingId === child.id ? '解除中…' : '外す'}</button>
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
            disabled={detachingId !== null}
            className="min-h-11 flex-1 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-text disabled:opacity-40"
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
    {showCarryover && issue && <CarryoverDialog issue={issue} onClose={() => setShowCarryover(false)}
      onCreated={next => { setShowCarryover(false); setRelatedIssueId(next.id) }} />}
    {relatedIssue && <IssueEditor key={relatedIssue.id} issue={relatedIssue}
      onClose={() => setRelatedIssueId(null)} />}
    </>
  )
}
