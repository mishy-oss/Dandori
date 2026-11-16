import { useEffect, useMemo, useRef, useState } from 'react'
import type { Issue } from '../../db/types'
import { columnIssues } from '../../lib/issueOrder'
import { selectCurrentProject, useDataStore } from '../../store/data'
import { issueMonth } from '../../lib/month'
import { MonthNavigator } from '../monthly/MonthNavigator'
import { MonthlyBurndown } from '../monthly/MonthlyBurndown'
import { IssueEditor } from '../issue-editor/IssueEditor'
import { BoardCard } from './BoardCard'
import { wipStatus } from './boardLogic'
import { useBoardGestures } from './useBoardGestures'
import { groupBoardIssues, groupedDropIndex, type BoardIssueGroup } from './recurringGroups'
import { RecurringBoardCard } from './RecurringBoardCard'

export function BoardScreen() {
  const project = useDataStore(selectCurrentProject)
  const workflow = useDataStore((s) => (project ? s.workflows[project.workflowId] : undefined))
  const allIssues = useDataStore((s) => s.issues)
  const recurrenceRules = useDataStore((s) => s.recurrenceRules)
  const month = useDataStore((state) => state.selectedMonth)
  const ready = useDataStore((s) => s.ready)
  const moveIssue = useDataStore((s) => s.moveIssue)
  const toggleIssueDone = useDataStore((s) => s.toggleIssueDone)

  const issues = useMemo(
    () => allIssues.filter((issue) => issueMonth(issue) === month),
    [allIssues, month],
  )
  const [columnIndex, setColumnIndex] = useState(0)
  const [editing, setEditing] = useState<Issue | 'new' | null>(null)
  const [pulseId, setPulseId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const statuses = useMemo(() => workflow?.statuses ?? [], [workflow])
  const doneIds = useMemo(
    () => new Set(statuses.filter((s) => s.category === 'done').map((s) => s.id)),
    [statuses],
  )
  const groups = useMemo(() => groupBoardIssues(issues, doneIds), [issues, doneIds])
  const activeIndex = Math.min(columnIndex, Math.max(statuses.length - 1, 0))
  const active = statuses[activeIndex]

  useEffect(() => {
    if (!pulseId) return
    const t = setTimeout(() => setPulseId(null), 400)
    return () => clearTimeout(t)
  }, [pulseId])

  async function toggleDone(issueId: string) {
    try {
      setError(null)
      await toggleIssueDone(issueId)
      const moved = useDataStore.getState().issues.find((i) => i.id === issueId)
      if (moved) setPulseId(`tab:${moved.statusId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function move(issueId: string, statusIdx: number, index: number) {
    const status = statuses[statusIdx]
    if (!status) return
    setPulseId(issueId)
    try {
      setError(null)
      await moveIssue(issueId, status.id, index, month)
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
      const latest = useDataStore.getState().issues.filter((issue) => issueMonth(issue) === month)
      void move(id, target, columnIssues(latest, statuses[target].id).length)
    },
    /* 非表示の繰り返し回も順位を持つため、カード数と保存先の位置は一致しない。 */
    onDrop: (id, col, index) => {
      const status = statuses[col]
      if (!status) return
      const latest = useDataStore.getState().issues.filter((issue) => issueMonth(issue) === month)
      void move(id, col, groupedDropIndex(latest, doneIds, id, status.id, index))
    },
  })

  if (!ready || !project || !active) return null

  const column = groups.filter((group) => group.issue.statusId === active.id)
  const actualCount = columnIssues(issues, active.id).length
  const wip = wipStatus(actualCount, active.wipLimit)
  const draggedGroup = drag ? groups.find((group) => group.issue.id === drag.issueId) : undefined

  // ドラッグ中のカードは列が切り替わっても同じ <ul> に残し、タッチ操作の対象要素を維持する
  const base = draggedGroup && !column.includes(draggedGroup) ? [...column, draggedGroup] : column
  const rows: Array<{ kind: 'card'; group: BoardIssueGroup } | { kind: 'placeholder' }> = []
  let seen = 0
  let placed = false
  for (const group of base) {
    if (drag && group.issue.id === drag.issueId) {
      rows.push({ kind: 'card', group })
      continue
    }
    if (drag && !placed && seen === dropIndex) {
      rows.push({ kind: 'placeholder' })
      placed = true
    }
    rows.push({ kind: 'card', group })
    seen++
  }
  if (drag && !placed) rows.push({ kind: 'placeholder' })

  return (
    <section className="flex min-h-full flex-col gap-3 p-4">
      <div>
        <h1 className="text-2xl font-bold">ボード</h1>
        <p className="text-sm text-muted">
          月ごとのタスクをステータス別に管理します
        </p>
      </div>

      <MonthNavigator />
      <details className="rounded-2xl border border-border bg-surface">
        <summary className="cursor-pointer p-3 text-xs font-medium">月次バーンダウンを見る</summary>
        <MonthlyBurndown />
      </details>

      <div role="tablist" aria-label="ステータス" className="-mx-4 flex gap-2 overflow-x-auto px-4">
        {statuses.map((s, i) => {
          const count = groups.filter((group) => group.issue.statusId === s.id).length
          const over = wipStatus(columnIssues(issues, s.id).length, s.wipLimit).over
          return (
            <button
              key={s.id}
              role="tab"
              aria-selected={i === activeIndex}
              onClick={() => setColumnIndex(i)}
              className={`flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm ${
                i === activeIndex ? 'border-accent bg-accent text-accent-text' : 'border-border bg-surface'
              } ${pulseId === `tab:${s.id}` ? 'animate-pop' : ''}`}
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
          ⚠ WIP上限({active.wipLimit}件)を超えています(実タスク{actualCount} tasks). You can still add tasks.
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
          const group = row.group
          const issue = group.issue
          if (group.recurring) {
            return <li key={group.key}>
              <RecurringBoardCard
                group={group}
                relatedIssues={allIssues}
                rule={recurrenceRules.find((rule) => rule.id === issue.recurrenceId)}
                statuses={statuses}
                doneIds={doneIds}
                pulse={group.occurrences.some((occurrence) => occurrence.id === pulseId)}
                onOpen={setEditing}
                onToggleDone={toggleDone}
                onChangeStatus={async (id, statusId) => {
                  const statusIndex = statuses.findIndex((status) => status.id === statusId)
                  const latest = useDataStore.getState().issues.filter((issue) => issueMonth(issue) === month)
                  await move(id, statusIndex, columnIssues(latest, statusId).length)
                }}
              />
            </li>
          }
          const isDragged = drag?.issueId === issue.id
          const swipeHere = swipe?.issueId === issue.id ? swipe : null
          return (
            <li key={group.key}>
              <BoardCard
                issue={issue}
                relatedIssues={allIssues}
                doneIds={doneIds}
                done={doneIds.has(issue.statusId)}
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
                onToggleDone={() => void toggleDone(issue.id)}
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
        className="app-fab"
      >
        +
      </button>

      {editing && (
        <IssueEditor
          key={editing === 'new' ? 'new' : editing.id}
          issue={editing === 'new' ? null : editing}
          defaultStatusId={active.id}
          defaultPlanningMonth={month}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}
