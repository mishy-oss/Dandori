import { useState, type FormEvent } from 'react'
import { ISSUE_TYPES, PRIORITIES, type Issue, type IssueType, type Priority } from '../../db/types'
import { selectCurrentProject, useDataStore } from '../../store/data'

const FIELD =
  'min-h-11 w-full rounded-lg border border-border bg-surface-2 px-3 text-base'

export function IssueEditor({
  issue,
  onClose,
}: {
  issue: Issue | null
  onClose: () => void
}) {
  const project = useDataStore(selectCurrentProject)
  const workflow = useDataStore((s) => (project ? s.workflows[project.workflowId] : undefined))
  const createIssue = useDataStore((s) => s.createIssue)
  const updateIssue = useDataStore((s) => s.updateIssue)
  const deleteIssue = useDataStore((s) => s.deleteIssue)

  const [title, setTitle] = useState(issue?.title ?? '')
  const [description, setDescription] = useState(issue?.description ?? '')
  const [type, setType] = useState<IssueType>(issue?.type ?? 'task')
  const [priority, setPriority] = useState<Priority>(issue?.priority ?? 'medium')
  const [statusId, setStatusId] = useState(issue?.statusId ?? workflow?.statuses[0]?.id ?? '')
  const [dueDate, setDueDate] = useState(issue?.dueDate ?? '')
  const [error, setError] = useState<string | null>(null)

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
    const common = {
      title,
      description: description || undefined,
      type,
      priority,
      statusId,
      dueDate: dueDate || null,
    }
    void run(() => (issue ? updateIssue(issue.id, common) : createIssue(common)))
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
            期限
            <input
              type="date"
              className={FIELD}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>
        </div>

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
