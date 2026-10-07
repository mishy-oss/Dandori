import { useEffect, useMemo, useRef, useState } from 'react'
import type { Issue } from '../../db/types'
import { columnIssues } from '../../lib/issueOrder'
import { selectActiveSprint, selectCurrentProject, useDataStore } from '../../store/data'
import { IssueEditor } from '../issue-editor/IssueEditor'
import { SprintOverdueBanner } from '../sprint/SprintOverdueBanner'
import { BoardCard } from './BoardCard'
import { wipStatus } from './boardLogic'
import { useBoardGestures } from './useBoardGestures'

// アクティブスプリントのIssueだけを表示するカンバン
export function BoardScreen() {
  const project = useDataStore(selectCurrentProject)
  const workflow = useDataStore((s) => (project ? s.workflows[project.workflowId] : undefined))
  const allIssues = useDataStore((s) => s.issues)
  const sprint = useDataStore(selectActiveSprint)
  const ready = useDataStore((s) => s.ready)
  const moveIssue = useDataStore((s) => s.moveIssue)

  const issues = useMemo(
    () => (sprint ? allIssues.filter((i) => i.sprintId === sprint.id) : []),
    [allIssues, sprint],
  )
  const [columnIndex, setColumnIndex] = useState(0)
  const [editing, setEditing] = useState<Issue | 'new' | null>(null)
  const [pulseId, setPulseId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const statuses = useMemo(() => workflow?.statuses ?? [], [workflow])
  const activeIndex = Math.min(columnIndex, Math.max(statuses.length - 1, 0))
  const active = statuses[activeIndex]

  useEffect(() => {
    if (!pulseId) return
    const t = setTimeout(() => setPulseId(null), 400)
    return () => clearTimeout(t)
  }, [pulseId])

  async function move(issueId: string, statusIdx: number, index: number) {
    const status = statuses[statusIdx]
    if (!status || !sprint) return
    setPulseId(issueId)
    try {
      setError(null)
      await moveIssue(issueId, status.id, index, sprint.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const { drag, dropIndex, swipe, onPointerDown, shouldSuppressClick } = useBoardGestures({
    listRef,
    activeIndex,
    columnCount: statuses.length,
    onSwitchColumn: setColumnIndex,
    onSwipeMove: (id, target) => {
      // 実行時点の最新の並びの末尾へ入れる(アニメーション待ちの間に状態が変わりうるため)
      const latest = useDataStore.getState().issues
      void move(id, target, columnIssues(latest, statuses[target].id, sprint?.id).length)
    },
    onDrop: (id, col, index) => void move(id, col, index),
  })

  if (!ready || !project || !active) return null

  if (!sprint) {
    return (
      <section className="flex flex-col gap-4 p-4">
        <h1 className="text-2xl font-bold">Board</h1>
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
          アクティブなスプリントがありません。Backlog でスプリントにIssueを追加して開始してください
        </p>
      </section>
    )
  }

  const column = columnIssues(issues, active.id)
  const wip = wipStatus(column.length, active.wipLimit)
  const draggedIssue = drag ? issues.find((i) => i.id === drag.issueId) : undefined

  // ドラッグ中のカードは列が切り替わっても同じ <ul> に残し、タッチ操作の対象要素を維持する
  const base = draggedIssue && !column.includes(draggedIssue) ? [...column, draggedIssue] : column
  const rows: Array<{ kind: 'card'; issue: Issue } | { kind: 'placeholder' }> = []
  let seen = 0
  let placed = false
  for (const issue of base) {
    if (drag && issue.id === drag.issueId) {
      rows.push({ kind: 'card', issue })
      continue
    }
    if (drag && !placed && seen === dropIndex) {
      rows.push({ kind: 'placeholder' })
      placed = true
    }
    rows.push({ kind: 'card', issue })
    seen++
  }
  if (drag && !placed) rows.push({ kind: 'placeholder' })

  return (
    <section className="flex min-h-full flex-col gap-3 p-4">
      <div>
        <h1 className="text-2xl font-bold">Board</h1>
        <p className="text-sm text-muted">
          {sprint.name}({sprint.startDate} 〜 {sprint.endDate})
        </p>
      </div>

      <SprintOverdueBanner />

      <div role="tablist" aria-label="ステータス" className="-mx-4 flex gap-2 overflow-x-auto px-4">
        {statuses.map((s, i) => {
          const count = columnIssues(issues, s.id).length
          const over = wipStatus(count, s.wipLimit).over
          return (
            <button
              key={s.id}
              role="tab"
              aria-selected={i === activeIndex}
              onClick={() => setColumnIndex(i)}
              className={`flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm ${
                i === activeIndex ? 'border-accent bg-accent text-accent-text' : 'border-border bg-surface'
              }`}
            >
              {s.name}
              <span
                className={`rounded-full px-2 text-xs ${
                  over ? 'bg-amber-500 text-black' : 'bg-black/10 dark:bg-white/10'
                }`}
              >
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {wip.over && (
        <p role="status" className="rounded-lg border border-amber-500 bg-amber-500/10 p-3 text-sm">
          ⚠ WIP上限({active.wipLimit}件)を超えています({column.length}件)。ブロックはしません
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-red-500 p-3 text-sm text-red-500">
          {error}
        </p>
      )}

      <ul
        ref={listRef}
        aria-label={active.name}
        onPointerDown={onPointerDown}
        onContextMenu={(e) => e.preventDefault()}
        className="flex flex-col gap-2 pb-24"
      >
        {rows.length === 0 && (
          <li className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
            この列にIssueはありません
          </li>
        )}
        {rows.map((row) => {
          if (row.kind === 'placeholder') {
            return (
              <li
                key="placeholder"
                aria-hidden
                className="rounded-xl border-2 border-dashed border-accent/60 bg-accent/10"
                style={{ height: drag?.height }}
              />
            )
          }
          const issue = row.issue
          const isDragged = drag?.issueId === issue.id
          const swipeHere = swipe?.issueId === issue.id ? swipe : null
          return (
            <li key={issue.id}>
              <BoardCard
                issue={issue}
                pulse={pulseId === issue.id}
                swipeDx={swipeHere?.dx}
                swipeAnimating={swipeHere ? !swipeHere.active : true}
                prevLabel={statuses[activeIndex - 1]?.name}
                nextLabel={statuses[activeIndex + 1]?.name}
                floating={
                  isDragged && drag
                    ? {
                        position: 'fixed',
                        left: drag.x - drag.grabX,
                        top: drag.y - drag.grabY,
                        width: drag.width,
                      }
                    : undefined
                }
                onOpen={() => {
                  if (!shouldSuppressClick()) setEditing(issue)
                }}
              />
            </li>
          )
        })}
      </ul>

      {drag && (
        <>
          {activeIndex > 0 && (
            <div
              aria-hidden
              className="pointer-events-none fixed left-0 top-1/2 z-40 -translate-y-1/2 rounded-r-lg bg-accent/80 px-2 py-3 text-xs font-semibold text-accent-text"
            >
              ← {statuses[activeIndex - 1].name}
            </div>
          )}
          {activeIndex < statuses.length - 1 && (
            <div
              aria-hidden
              className="pointer-events-none fixed right-0 top-1/2 z-40 -translate-y-1/2 rounded-l-lg bg-accent/80 px-2 py-3 text-xs font-semibold text-accent-text"
            >
              {statuses[activeIndex + 1].name} →
            </div>
          )}
        </>
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
          defaultStatusId={active.id}
          defaultSprintId={sprint.id}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}
