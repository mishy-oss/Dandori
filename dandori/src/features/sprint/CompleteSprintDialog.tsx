import { useMemo, useState } from 'react'
import { FIELD_CLASS } from '../../app/fields'
import { Sheet } from '../../app/Sheet'
import type { IncompleteIssuesAction } from '../../db/sprintRepo'
import type { Sprint } from '../../db/types'
import { selectCurrentProject, useDataStore } from '../../store/data'

type Choice = 'sprint' | 'new' | 'backlog'

export function CompleteSprintDialog({ sprint, onClose }: { sprint: Sprint; onClose: () => void }) {
  const project = useDataStore(selectCurrentProject)
  const workflow = useDataStore((s) => (project ? s.workflows[project.workflowId] : undefined))
  const issues = useDataStore((s) => s.issues)
  const sprints = useDataStore((s) => s.sprints)
  const completeSprint = useDataStore((s) => s.completeSprint)

  const planned = useMemo(() => sprints.filter((s) => s.state === 'planned'), [sprints])
  const { done, open } = useMemo(() => {
    const doneIds = new Set(
      (workflow?.statuses ?? []).filter((s) => s.category === 'done').map((s) => s.id),
    )
    const inSprint = issues.filter((i) => i.sprintId === sprint.id)
    const doneCount = inSprint.filter((i) => doneIds.has(i.statusId)).length
    return { done: doneCount, open: inSprint.length - doneCount }
  }, [issues, workflow, sprint.id])

  const [choice, setChoice] = useState<Choice>(planned.length > 0 ? 'sprint' : 'new')
  const [nextId, setNextId] = useState(planned[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const action: IncompleteIssuesAction =
      choice === 'sprint' ? { to: 'sprint', sprintId: nextId } : choice === 'new' ? { to: 'new' } : { to: 'backlog' }
    try {
      await completeSprint(sprint.id, action)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const options: { value: Choice; label: string; hidden?: boolean }[] = [
    { value: 'sprint', label: '次のスプリントへ持ち越す', hidden: planned.length === 0 },
    { value: 'new', label: '新しいスプリントを作って持ち越す' },
    { value: 'backlog', label: 'バックログへ戻す' },
  ]

  return (
    <Sheet label="スプリントを完了" onClose={onClose}>
      <h2 className="text-lg font-bold">{sprint.name} を完了</h2>
      <p className="text-sm text-muted">
        完了 {done}件 / 未完了 {open}件
      </p>

      {open > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">未完了のIssueの扱い</legend>
          {options
            .filter((o) => !o.hidden)
            .map((o) => (
              <label key={o.value} className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3">
                <input
                  type="radio"
                  name="incomplete"
                  checked={choice === o.value}
                  onChange={() => setChoice(o.value)}
                />
                {o.label}
              </label>
            ))}
          {choice === 'sprint' && (
            <select
              aria-label="持ち越し先"
              className={FIELD_CLASS}
              value={nextId}
              onChange={(e) => setNextId(e.target.value)}
            >
              {planned.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}({s.startDate} 〜 {s.endDate})
                </option>
              ))}
            </select>
          )}
        </fieldset>
      ) : (
        <p className="rounded-lg border border-border p-3 text-sm">未完了のIssueはありません</p>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" className="min-h-11 flex-1 rounded-lg border border-border text-sm" onClick={onClose}>
          キャンセル
        </button>
        <button
          type="button"
          className="min-h-11 flex-1 rounded-lg bg-accent text-sm font-semibold text-accent-text"
          onClick={() => void submit()}
        >
          完了する
        </button>
      </div>
    </Sheet>
  )
}
