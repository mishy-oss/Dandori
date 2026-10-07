import { useState } from 'react'
import { Screen } from '../../app/Screen'
import type { Issue } from '../../db/types'
import { selectCurrentProject, useDataStore } from '../../store/data'
import { IssueEditor } from '../issue-editor/IssueEditor'

export function BacklogScreen() {
  const project = useDataStore(selectCurrentProject)
  const issues = useDataStore((s) => s.issues)
  const workflow = useDataStore((s) => (project ? s.workflows[project.workflowId] : undefined))
  const ready = useDataStore((s) => s.ready)
  const [editing, setEditing] = useState<Issue | 'new' | null>(null)

  if (!ready) return null

  if (!project) {
    return (
      <Screen title="Backlog">
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
          「設定」でプロジェクトを作成すると、Issueを追加できます
        </p>
      </Screen>
    )
  }

  const statusName = (id: string) => workflow?.statuses.find((s) => s.id === id)?.name ?? ''

  return (
    <Screen title="Backlog">
      <p className="-mt-2 text-sm text-muted">{project.name}</p>
      {issues.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
          Issueがありません。右下の + から作成できます
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {issues.map((i) => (
            <li key={i.id}>
              <button
                onClick={() => setEditing(i)}
                className="flex min-h-14 w-full flex-col items-start gap-1 rounded-xl border border-border bg-surface p-3 text-left"
              >
                <span className="text-xs text-muted">
                  {project.key}-{i.number} · {i.type} · {i.priority}
                </span>
                <span className={i.completedAt ? 'line-through opacity-60' : ''}>{i.title}</span>
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">
                  {statusName(i.statusId)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        aria-label="Issueを作成"
        onClick={() => setEditing('new')}
        className="fixed right-4 z-30 flex size-14 items-center justify-center rounded-full bg-accent text-3xl text-accent-text shadow-lg"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 72px)' }}
      >
        +
      </button>

      {editing && (
        <IssueEditor
          key={editing === 'new' ? 'new' : editing.id}
          issue={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Screen>
  )
}
