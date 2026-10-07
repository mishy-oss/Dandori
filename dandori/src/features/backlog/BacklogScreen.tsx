import { useMemo, useState } from 'react'
import { FIELD_CLASS } from '../../app/fields'
import { Screen } from '../../app/Screen'
import { ISSUE_TYPES, PRIORITIES, type Issue, type IssueType, type Priority, type Sprint } from '../../db/types'
import { selectCurrentProject, useDataStore } from '../../store/data'
import { IssueEditor } from '../issue-editor/IssueEditor'
import { CompleteSprintDialog } from '../sprint/CompleteSprintDialog'
import { SprintFormSheet } from '../sprint/SprintFormSheet'
import { SprintOverdueBanner } from '../sprint/SprintOverdueBanner'
import { BacklogRow } from './BacklogRow'
import { EMPTY_FILTER, isFilterActive, matchesFilter, type IssueFilter } from './filters'
import { MoveSheet } from './MoveSheet'
import { SprintSection } from './SprintSection'

const STATE_ORDER = { active: 0, planned: 1, closed: 2 } as const

export function BacklogScreen() {
  const project = useDataStore(selectCurrentProject)
  const issues = useDataStore((s) => s.issues)
  const sprints = useDataStore((s) => s.sprints)
  const workflow = useDataStore((s) => (project ? s.workflows[project.workflowId] : undefined))
  const ready = useDataStore((s) => s.ready)
  const startSprint = useDataStore((s) => s.startSprint)
  const deleteSprint = useDataStore((s) => s.deleteSprint)

  const [filter, setFilter] = useState<IssueFilter>(EMPTY_FILTER)
  const [showClosed, setShowClosed] = useState(false)
  const [editing, setEditing] = useState<Issue | 'new' | null>(null)
  const [moving, setMoving] = useState<Issue | null>(null)
  const [sprintForm, setSprintForm] = useState<Sprint | 'new' | null>(null)
  const [completing, setCompleting] = useState<Sprint | null>(null)
  const [error, setError] = useState<string | null>(null)

  const doneIds = useMemo(
    () => new Set((workflow?.statuses ?? []).filter((s) => s.category === 'done').map((s) => s.id)),
    [workflow],
  )

  if (!ready || !project) return null

  const statusName = (id: string) => workflow?.statuses.find((s) => s.id === id)?.name ?? ''
  const match = (i: Issue) => matchesFilter(i, filter)
  const filtered = isFilterActive(filter)
  const visibleSprints = sprints
    .filter((s) => showClosed || s.state !== 'closed')
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state])
  const closedCount = sprints.filter((s) => s.state === 'closed').length
  const backlog = issues.filter((i) => i.sprintId === null)
  const backlogVisible = backlog.filter(match)

  async function run(action: () => Promise<unknown>) {
    try {
      setError(null)
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Screen title="Backlog">
      <div className="-mt-2 flex items-center gap-2">
        <p className="flex-1 text-sm text-muted">{issues.length}件</p>
        <button
          onClick={() => setSprintForm('new')}
          className="min-h-11 rounded-lg border border-border bg-surface px-4 text-sm"
        >
          ＋ スプリント
        </button>
      </div>

      <SprintOverdueBanner />

      <div role="search" className="flex flex-col gap-2">
        <input
          type="search"
          aria-label="検索"
          placeholder="タイトル・キー・ラベルで検索"
          className={FIELD_CLASS}
          value={filter.query}
          onChange={(e) => setFilter({ ...filter, query: e.target.value })}
        />
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <select
            aria-label="優先度で絞り込み"
            className={FIELD_CLASS}
            value={filter.priority}
            onChange={(e) => setFilter({ ...filter, priority: e.target.value as Priority | 'all' })}
          >
            <option value="all">優先度: すべて</option>
            {PRIORITIES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <select
            aria-label="種別で絞り込み"
            className={FIELD_CLASS}
            value={filter.type}
            onChange={(e) => setFilter({ ...filter, type: e.target.value as IssueType | 'all' })}
          >
            <option value="all">種別: すべて</option>
            {ISSUE_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <button
            disabled={!filtered}
            onClick={() => setFilter(EMPTY_FILTER)}
            className="min-h-11 rounded-lg border border-border px-3 text-sm disabled:opacity-40"
          >
            クリア
          </button>
        </div>
        {closedCount > 0 && (
          <label className="flex min-h-11 items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
            完了したスプリントを表示({closedCount})
          </label>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-500 p-3 text-sm text-red-500">
          {error}
        </p>
      )}

      {visibleSprints.map((s) => {
        const inSprint = issues.filter((i) => i.sprintId === s.id)
        return (
          <SprintSection
            key={s.id}
            sprint={s}
            issues={inSprint.filter(match)}
            allCount={inSprint.length}
            doneCount={inSprint.filter((i) => doneIds.has(i.statusId)).length}
            estimateMin={inSprint.reduce((sum, i) => sum + (i.estimateMin ?? 0), 0)}
            filtered={filtered}
            statusName={statusName}
            onOpen={setEditing}
            onMove={setMoving}
            onStart={() => void run(() => startSprint(s.id))}
            onComplete={() => setCompleting(s)}
            onEdit={() => setSprintForm(s)}
            onDelete={() => {
              if (confirm(`「${s.name}」を削除しますか?(中のIssueはバックログへ戻ります)`)) {
                void run(() => deleteSprint(s.id))
              }
            }}
          />
        )
      })}

      <section aria-label="バックログ" className="flex flex-col gap-2 rounded-xl border border-border bg-bg p-3">
        <h2 className="font-semibold">
          バックログ <span className="text-xs font-normal text-muted">{backlog.length}件</span>
        </h2>
        {backlogVisible.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted">
            {filtered && backlog.length > 0
              ? '条件に一致するIssueはありません'
              : 'Issueがありません。右下の + から作成できます'}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {backlogVisible.map((i) => (
              <li key={i.id}>
                <BacklogRow
                  issue={i}
                  statusName={statusName(i.statusId)}
                  onOpen={() => setEditing(i)}
                  onMove={() => setMoving(i)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

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
      {moving && (
        <MoveSheet
          key={moving.id}
          issue={moving}
          sprints={sprints}
          onClose={() => setMoving(null)}
        />
      )}
      {sprintForm && (
        <SprintFormSheet
          key={sprintForm === 'new' ? 'new' : sprintForm.id}
          sprint={sprintForm === 'new' ? null : sprintForm}
          onClose={() => setSprintForm(null)}
        />
      )}
      {completing && <CompleteSprintDialog sprint={completing} onClose={() => setCompleting(null)} />}
    </Screen>
  )
}
