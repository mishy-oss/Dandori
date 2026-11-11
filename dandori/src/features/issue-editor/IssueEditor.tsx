import { useMemo, useState, type FormEvent } from 'react'
import { ISSUE_TYPES, PRIORITIES, type Issue, type IssueType, type Priority, type RecurrenceFrequency } from '../../db/types'
import { formatIssueNumber } from '../../lib/issueNumber'
import { todayStr } from '../../lib/date'
import { currentMonth, isValidMonth, issueMonth } from '../../lib/month'
import { selectCurrentProject, useDataStore } from '../../store/data'
import { formatMin, parseTime } from '../timeline/timelineLogic'
import { scheduledEditorStatusId } from './issueEditorLogic'

const FIELD =
  'min-h-11 w-full rounded-lg border border-border bg-surface-2 px-3 text-base'
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

/** Issueの作成・編集フォームを表示し、親子関係・スケジュール・曜日を含む繰り返し・通知設定を入力して保存する。 */
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
  const workflow = useDataStore(/* 現在のプロジェクトに対応するワークフローをストアから取得する。 */ (s) => (project ? s.workflows[project.workflowId] : undefined))
  const defaultDuration = useDataStore(/* ストアから既定の所要時間を取得する。 */ (s) => s.settings.defaultDuration)
  const createIssue = useDataStore(/* ストアからcreateIssue（保存・状態変更の操作）を取得する。 */ (s) => s.createIssue)
  const updateIssue = useDataStore(/* ストアからupdateIssue（保存・状態変更の操作）を取得する。 */ (s) => s.updateIssue)
  const deleteIssue = useDataStore(/* ストアからdeleteIssue（保存・状態変更の操作）を取得する。 */ (s) => s.deleteIssue)
  const moveIssue = useDataStore(/* ストアからmoveIssue（保存・状態変更の操作）を取得する。 */ (s) => s.moveIssue)
  const stopRecurrence = useDataStore(/* ストアからstopRecurrence（保存・状態変更の操作）を取得する。 */ (s) => s.stopRecurrence)
  const recurrenceRule = useDataStore(/* Issueの繰り返しIDに一致するルールをストアから取り出す。 */ (s) => s.recurrenceRules.find(/* 指定IDと一致という条件を最初に満たす要素を探す。 */ (rule) => rule.id === issue?.recurrenceId))
  const issues = useDataStore(/* ストアからIssueを取得する。 */ (s) => s.issues)
  // 並び順は同じステータス・同じ対象月の中で扱う。
  const column = useMemo(
    () =>
      issue
        ? issues.filter(/* 同じ月とステータスのタスクを取り出す。 */ (i) => i.statusId === issue.statusId && issueMonth(i) === issueMonth(issue))
        : [],
    [issues, issue],
  )
  const position = issue ? column.findIndex(/* 指定IDと一致という条件を最初に満たす要素の位置を探す。 */ (i) => i.id === issue.id) : -1

  const [title, setTitle] = useState(issue?.title ?? '')
  const [description, setDescription] = useState(issue?.description ?? '')
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
  const [reminderOffsetMin, setReminderOffsetMin] = useState<number | null>(issue ? issue.reminderOffsetMin : 0)
  const [recurrence, setRecurrence] = useState<RecurrenceFrequency | ''>(recurrenceRule?.frequency ?? '')
  const [recurrenceInterval, setRecurrenceInterval] = useState(String(recurrenceRule?.interval ?? 1))
  /** 保存済みの繰り返し曜日を初期値にし、未設定なら予定日または今日の曜日を選ぶ。 */
  const [recurrenceWeekdays, setRecurrenceWeekdays] = useState<number[]>(() =>
    recurrenceRule?.weekdays ?? [new Date(`${date || todayStr()}T00:00:00`).getDay()],
  )
  const [recurrenceEndDate, setRecurrenceEndDate] = useState(recurrenceRule?.endDate ?? '')
  const [error, setError] = useState<string | null>(null)
  const [childTitle, setChildTitle] = useState('')
  const [addingChild, setAddingChild] = useState(false)
  const [relatedIssueId, setRelatedIssueId] = useState<string | null>(null)
  const relatedIssue = issues.find((item) => item.id === relatedIssueId)
  const issueId = issue?.id

  /** 親候補に自分の子孫を出さないため、子Issueをたどって全子孫のIDを集める。 */
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
  const parentOptions = issues.filter(/* 自分と子孫を親候補から除外・操作対象のIDを除外という条件を満たす要素だけを残す。 */ (i) => i.id !== issueId && !descendants.has(i.id))
  const children = issueId ? issues.filter(/* 指定の親Issueと一致という条件を満たす要素だけを残す。 */ (i) => i.parentId === issueId) : []
  const isRoutine = workflow?.statuses.find((status) => status.id === statusId)?.category === 'routine'

  /** 編集中のIssueを同じステータス・対象月の中で1つ上または下へ移動する。 */
  async function reorder(delta: -1 | 1) {
    if (!issue) return
    try {
      await moveIssue(issue.id, issue.statusId, position + delta, issueMonth(issue))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  /** 指定された保存・削除処理を実行して成功時に編集画面を閉じ、失敗時はエラーを表示する。 */
  async function run(action: () => Promise<unknown>) {
    try {
      await action()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  /** 入力されたタイトルで編集中Issueの子タスクを作り、成功時に入力欄を空にする。処理中の重複登録を防ぐ。 */
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

  /** 対象月・時刻・繰り返し曜日を確認し、新規作成または編集内容を保存する。 */
  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!isValidMonth(planningMonth)) { setError('対象月を選択してください'); return }
    const startMin = startTime ? parseTime(startTime) : null
    if (startTime && startMin === null) {
      setError('開始時刻が正しくありません')
      return
    }
    if (recurrence === 'weekly' && recurrenceWeekdays.length === 0) {
      setError('繰り返す曜日を1つ以上選択してください')
      return
    }
    const scheduleChanged = !issue || issue.date !== (date || null) || issue.startMin !== startMin
    const common = {
      title,
      description: description || undefined,
      type,
      priority,
      statusId: scheduledEditorStatusId(workflow?.statuses ?? [], statusId, date || null, startMin, scheduleChanged),
      parentId,
      dueDate: dueDate || null,
      date: date || null,
      startMin,
      durationMin: Number(duration),
      reminderOffsetMin,
      planningMonth,
      sprintId: null,
    }
    void run(/* 入力した対象月と各項目・繰り返し設定を保存する。 */ async () => {
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
        onClick={/* クリックが背景へ伝わってダイアログを閉じないようにする。 */ (e) => e.stopPropagation()}
        className="mx-auto flex max-h-[90%] w-full max-w-xl flex-col gap-3 overflow-y-auto rounded-t-2xl bg-surface p-4"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
      >
        <h2 className="text-lg font-bold">
          {issue ? formatIssueNumber(issue.number) : '新規Issue'}
        </h2>

        <label className="flex flex-col gap-1 text-sm text-muted">
          タイトル
          <input
            className={FIELD}
            value={title}
            onChange={/* 入力された値に合わせてタイトルを更新する。 */ (e) => setTitle(e.target.value)}
            autoFocus={!issue}
          />
        </label>

        <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-semibold text-muted">繰り返し</legend>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-sm text-muted">
                頻度
                <select
                  className={FIELD}
                  value={recurrence}
                  onChange={/* 入力された値に合わせて繰り返し頻度を更新する。 */ (e) => setRecurrence(e.target.value as RecurrenceFrequency | '')}
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
                      onChange={/* 入力された値に合わせて繰り返し間隔を更新する。 */ (e) => setRecurrenceInterval(e.target.value)}
                    />
                    <span>{recurrence === 'daily' ? '日' : recurrence === 'weekly' ? '週' : 'か月'}</span>
                  </span>
                </label>
              )}
              {recurrence === 'weekly' && (
                <div className="col-span-2 flex flex-col gap-1 text-sm text-muted">
                  <span>曜日（複数選択可）</span>
                  <div className="grid grid-cols-7 gap-1" role="group" aria-label="繰り返す曜日">
                    {WEEKDAY_LABELS.map(/* 各曜日の選択肢の表示要素を作り、対応する選択・編集操作を結び付ける。 */ (label, weekday) => {
                      const selected = recurrenceWeekdays.includes(weekday)
                      return (
                        <button
                          key={weekday}
                          type="button"
                          aria-pressed={selected}
                          onClick={/* クリックした曜日を選択一覧へ追加または削除し、曜日順に並べる。 */ () =>
                            setRecurrenceWeekdays(/* 選択済みの曜日は除き、未選択の曜日は追加して曜日順に並べる。 */ (current) =>
                              selected
                                ? current.filter(/* クリックした曜日を選択済み曜日の一覧から取り除く。 */ (day) => day !== weekday)
                                : [...current, weekday].sort(/* 数値を比較し、小さい値から順に並べる。 */ (a, b) => a - b),
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
                    onChange={/* 入力された値に合わせて繰り返し終了日を更新する。 */ (e) => setRecurrenceEndDate(e.target.value)}
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
                onClick={/* 繰り返し停止を実行し、成功時に編集画面を閉じる。 */ () => void run(/* 対象Issueの繰り返しルールを無効にする処理を呼び出す。 */ () => stopRecurrence(recurrenceRule.id))}
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
            onChange={/* 入力された値に合わせて説明を更新する。 */ (e) => setDescription(e.target.value)}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm text-muted">
            種別
            <select className={FIELD} value={type} onChange={/* 入力された値に合わせてIssueの種別を更新する。 */ (e) => setType(e.target.value as IssueType)}>
              {ISSUE_TYPES.map(/* 各Issueの種別の表示要素を作り、対応する選択・編集操作を結び付ける。 */ (t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted">
            優先度
            <select
              className={FIELD}
              value={priority}
              onChange={/* 入力された値に合わせて優先度を更新する。 */ (e) => setPriority(e.target.value as Priority)}
            >
              {PRIORITIES.map(/* 各優先度の選択肢の表示要素を作り、対応する選択・編集操作を結び付ける。 */ (p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted">
            ステータス
            <select className={FIELD} value={statusId} onChange={/* 入力された値に合わせてステータスIDを更新する。 */ (e) => setStatusId(e.target.value)}>
              {workflow?.statuses.map(/* 各ステータスの表示要素を作り、対応する選択・編集操作を結び付ける。 */ (s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted">
            対象月
            <input type="month" className={FIELD} value={planningMonth}
              onChange={/* 対象月を変えたとき、別の月にある時刻配置は解除する。 */ (event) => {
                const month = event.target.value
                setPlanningMonth(month)
                if (date && date.slice(0, 7) !== month) { setDate(''); setStartTime('') }
              }} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted">
            親Issue / Epic
            <select className={FIELD} value={parentId ?? ''} onChange={/* 入力された値に合わせて親IssueのIDを更新する。 */ (e) => setParentId(e.target.value || null)}>
              <option value="">なし</option>
              {parentOptions.map(/* 各親Issueの候補の表示要素を作り、対応する選択・編集操作を結び付ける。 */ (parent) => (
                <option key={parent.id} value={parent.id}>
                  {parent.type === 'epic' ? 'Epic' : parent.type} · {formatIssueNumber(parent.number)} · {parent.title}
                </option>
              ))}
            </select>
            {parentId && <button type="button" className="min-h-11 text-left text-xs text-accent"
              onClick={/* 親の編集を重ねて開き、戻ったときは入力中の内容を保持する。 */ () => setRelatedIssueId(parentId)}>親タスクを編集</button>}
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-sm text-muted">
            通知
            <select
              className={FIELD}
              value={reminderOffsetMin === null ? 'none' : String(reminderOffsetMin)}
              onChange={/* 入力された値に合わせて通知タイミングを更新する。 */ (e) => setReminderOffsetMin(e.target.value === 'none' ? null : Number(e.target.value))}
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
              onChange={/* 入力された値に合わせて期限を更新する。 */ (e) => setDueDate(e.target.value)}
            />
          </label>
        </div>

        <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-semibold text-muted">スケジュール(タイムライン)</legend>
          <div className="grid grid-cols-3 gap-2">
            <label className="col-span-3 flex flex-col gap-1 text-sm text-muted sm:col-span-1">
              日付
              <input type="date" className={FIELD} value={date} onChange={/* 予定日を変えたら対象月も同じ月に合わせる。 */ (e) => { setDate(e.target.value); if (e.target.value) setPlanningMonth(e.target.value.slice(0, 7)) }} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-muted">
              開始時刻
              <input
                type="time"
                step={300}
                className={FIELD}
                value={startTime}
                onChange={/* 入力された値に合わせて開始時刻を更新する。 */ (e) => setStartTime(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-muted">
              所要(分)
              <input
                type="number"
                inputMode="numeric"
                min={5}
                step={5}
                className={FIELD}
                value={duration}
                onChange={/* 入力された値に合わせて所要時間を更新する。 */ (e) => setDuration(e.target.value)}
              />
            </label>
          </div>
          <button
            type="button"
            disabled={!startTime}
            onClick={/* 操作内容に合わせて開始時刻を更新する。 */ () => setStartTime('')}
            className="min-h-11 rounded-lg border border-border text-sm disabled:opacity-40"
          >
            未配置に戻す(時刻をクリア)
          </button>
        </fieldset>

        {isRoutine && <p className="text-xs text-muted">Recurring：会議など決まった時間の予定に使います。日付・開始時刻と、必要に応じて繰り返しを設定してください。</p>}
        {issue && (
          <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-semibold text-muted">
              子Issue / サブタスク ({children.length})
            </legend>
            {children.length > 0 && <p className="text-xs text-muted">親のステータスは子タスクの進捗に連動します。子タスクを押すと編集できます。</p>}
            {children.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {children.map(/* 各子Issueの表示要素を作り、対応する選択・編集操作を結び付ける。 */ (child) => (
                  <li key={child.id} className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                    <span className="shrink-0 text-xs text-muted">{child.type === 'epic' ? 'Epic' : child.type} · {formatIssueNumber(child.number)}</span>
                    <button type="button" aria-label={`${child.title}を編集`} className="min-h-11 min-w-0 flex-1 truncate text-left text-accent"
                      onClick={/* 子の編集を重ねて開き、閉じると親の入力内容へ戻る。 */ () => setRelatedIssueId(child.id)}>{child.title}</button>
                    <span className="shrink-0 text-xs text-muted">{workflow?.statuses.find(/* 指定IDと一致という条件を最初に満たす要素を探す。 */ (s) => s.id === child.statusId)?.name}</span>
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
                onChange={/* 入力された値に合わせて子タスクのタイトルを更新する。 */ (e) => setChildTitle(e.target.value)}
                onKeyDown={/* Enterまたはスペースで対象Issueを開き、キーボードからも編集できるようにする。 */ (e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void addChild()
                  }
                }}
              />
              <button
                type="button"
                disabled={!childTitle.trim() || addingChild}
                onClick={/* 入力されたタイトルで子タスクを追加する。 */ () => void addChild()}
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
              onClick={/* 編集中のIssueを同じ列内で1つ上へ移す。 */ () => void reorder(-1)}
              className="min-h-11 min-w-11 rounded-lg border border-border disabled:opacity-40"
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="列内で下へ移動"
              disabled={position < 0 || position >= column.length - 1}
              onClick={/* 編集中のIssueを同じ列内で1つ下へ移す。 */ () => void reorder(1)}
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
              onClick={/* 対象Issueと子孫の削除を実行し、結果に応じて編集画面を閉じるかエラーを表示する。 */ () => {
                if (confirm('このIssueを削除しますか?')) void run(/* 対象Issueと子孫の削除処理を呼び出す。 */ () => deleteIssue(issue.id))
              }}
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
    {relatedIssue && <IssueEditor key={relatedIssue.id} issue={relatedIssue}
      onClose={/* 関連タスクの編集を閉じて元の編集画面に戻す。 */ () => setRelatedIssueId(null)} />}
    </>
  )
}
