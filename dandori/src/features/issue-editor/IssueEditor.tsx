import { useMemo, useState, type FormEvent } from 'react'
import { ISSUE_TYPES, PRIORITIES, type Issue, type IssueType, type Priority } from '../../db/types'
import { selectCurrentProject, useDataStore } from '../../store/data'
import { formatMin, parseTime } from '../timeline/timelineLogic'

const FIELD =
  'min-h-11 w-full rounded-lg border border-border bg-surface-2 px-3 text-base'

export function IssueEditor({
  issue,
  defaultStatusId,
  defaultSprintId = null,
  initialSchedule,
  onClose,
}: {
  issue: Issue | null
  defaultStatusId?: string
  defaultSprintId?: string | null
  initialSchedule?: { date: string | null; startMin: number | null }
  onClose: () => void
}) {
  const project = useDataStore(selectCurrentProject)
  const workflow = useDataStore((s) => (project ? s.workflows[project.workflowId] : undefined))
  const sprints = useDataStore((s) => s.sprints)
  const defaultDuration = useDataStore((s) => s.settings.defaultDuration)
  const createIssue = useDataStore((s) => s.createIssue)
  const updateIssue = useDataStore((s) => s.updateIssue)
  const deleteIssue = useDataStore((s) => s.deleteIssue)
  const moveIssue = useDataStore((s) => s.moveIssue)
  const assignIssueToSprint = useDataStore((s) => s.assignIssueToSprint)
  const issues = useDataStore((s) => s.issues)
  // 並び順は「同じステータス・同じスプリント(またはバックログ)」の中で扱う
  const column = useMemo(
    () =>
      issue
        ? issues.filter((i) => i.statusId === issue.statusId && i.sprintId === issue.sprintId)
        : [],
    [issues, issue],
  )
  const position = issue ? column.findIndex((i) => i.id === issue.id) : -1
  const sprintOptions = sprints.filter((s) => s.state !== 'closed' || s.id === issue?.sprintId)

  const [title, setTitle] = useState(issue?.title ?? '')
  const [description, setDescription] = useState(issue?.description ?? '')
  const [type, setType] = useState<IssueType>(issue?.type ?? 'task')
  const [priority, setPriority] = useState<Priority>(issue?.priority ?? 'medium')
  const [statusId, setStatusId] = useState(
    issue?.statusId ?? defaultStatusId ?? workflow?.statuses[0]?.id ?? '',
  )
  const [sprintId, setSprintId] = useState<string | null>(issue ? issue.sprintId : defaultSprintId)
  const [dueDate, setDueDate] = useState(issue?.dueDate ?? '')
  const [date, setDate] = useState(issue?.date ?? initialSchedule?.date ?? '')
  const startInit = issue ? issue.startMin : (initialSchedule?.startMin ?? null)
  const [startTime, setStartTime] = useState(startInit === null ? '' : formatMin(startInit))
  const [duration, setDuration] = useState(String(issue?.durationMin ?? defaultDuration))
  const [error, setError] = useState<string | null>(null)

  async function reorder(delta: -1 | 1) {
    if (!issue) return
    try {
      await moveIssue(issue.id, issue.statusId, position + delta, issue.sprintId)
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

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const startMin = startTime ? parseTime(startTime) : null
    if (startTime && startMin === null) {
      setError('開始時刻が正しくありません')
      return
    }
    const common = {
      title,
      description: description || undefined,
      type,
      priority,
      statusId,
      dueDate: dueDate || null,
      date: date || null,
      startMin,
      durationMin: Number(duration),
    }
    void run(async () => {
      if (!issue) {
        await createIssue({ ...common, sprintId })
        return
      }
      if (sprintId !== issue.sprintId) await assignIssueToSprint(issue.id, sprintId)
      await updateIssue(issue.id, common)
    })
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/50" onClick={onClose}>
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
          {issue && project ? `${project.key}-${issue.number}` : '新規Issue'}
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
                <option key={p}>{p}</option>
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
            スプリント
            <select
              className={FIELD}
              value={sprintId ?? ''}
              onChange={(e) => setSprintId(e.target.value || null)}
            >
              <option value="">バックログ</option>
              {sprintOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
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
          <legend className="px-1 text-sm font-semibold text-muted">スケジュール(タイムライン)</legend>
          <div className="grid grid-cols-3 gap-2">
            <label className="col-span-3 flex flex-col gap-1 text-sm text-muted sm:col-span-1">
              日付
              <input type="date" className={FIELD} value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-muted">
              開始時刻
              <input
                type="time"
                step={300}
                className={FIELD}
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
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
                onChange={(e) => setDuration(e.target.value)}
              />
            </label>
          </div>
          <button
            type="button"
            disabled={!startTime}
            onClick={() => setStartTime('')}
            className="min-h-11 rounded-lg border border-border text-sm disabled:opacity-40"
          >
            未配置に戻す(時刻をクリア)
          </button>
        </fieldset>

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
              onClick={() => {
                if (confirm('このIssueを削除しますか?')) void run(() => deleteIssue(issue.id))
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
  )
}
