import { useEffect, useMemo, useRef, useState } from 'react'
import { ISSUE_TYPES, PRIORITIES, PRIORITY_LABELS, type Issue, type IssueType, type Priority } from '../../db/types'
import { FIELD_CLASS } from '../../app/fields'
import { columnIssues } from '../../lib/issueOrder'
import { selectCurrentProject, useDataStore } from '../../store/data'
import { issueMonth } from '../../lib/month'
import { MonthNavigator } from '../monthly/MonthNavigator'
import { MonthlyBurndown } from '../monthly/MonthlyBurndown'
import { IssueEditor } from '../issue-editor/IssueEditor'
import { BoardCard } from './BoardCard'
import { wipStatus } from './boardLogic'
import { useBoardGestures } from './useBoardGestures'
import { groupedDropIndex, type BoardIssueGroup } from './recurringGroups'
import { RecurringBoardCard } from './RecurringBoardCard'
import { CarryoverTrail } from './CarryoverTrail'
import { currentWork } from '../../lib/carryover'
import { EMPTY_FILTER, isFilterActive, type IssueFilter } from '../backlog/filters'
import { MoveSheet } from '../backlog/MoveSheet'
import { selectBoardGroups, statusMoveScope } from './boardView'

export function BoardScreen() {
  const project = useDataStore(selectCurrentProject)
  const workflow = useDataStore((s) => (project ? s.workflows[project.workflowId] : undefined))
  const allIssues = useDataStore((s) => s.issues)
  const recurrenceRules = useDataStore((s) => s.recurrenceRules)
  const month = useDataStore((state) => state.selectedMonth)
  const ready = useDataStore((s) => s.ready)
  const moveIssue = useDataStore((s) => s.moveIssue)
  const toggleIssueDone = useDataStore((s) => s.toggleIssueDone)
  const [filter, setFilter] = useState<IssueFilter>(EMPTY_FILTER)
  const [allMonths, setAllMonths] = useState(false)
  const [moving, setMoving] = useState<Issue | null>(null)

  const issues = useMemo(
    () => currentWork(allIssues).filter((issue) => allMonths || issueMonth(issue) === month),
    [allIssues, month, allMonths],
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
  const groups = useMemo(() => selectBoardGroups(allIssues, doneIds, month, allMonths, filter), [allIssues, doneIds, month, allMonths, filter])
  const taskCount = groups.reduce((total, group) => total + group.occurrences.length, 0)
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

  async function move(issueId: string, statusIdx: number, index: number, scopeMonth = month) {
    const status = statuses[statusIdx]
    if (!status) return
    setPulseId(issueId)
    try {
      setError(null)
      await moveIssue(issueId, status.id, index, scopeMonth)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function changeStatus(id: string, statusId: string) {
    const scope = statusMoveScope(useDataStore.getState().issues, id, statusId)
    if (scope) await move(id, statuses.findIndex(status => status.id === statusId), scope.index, scope.month)
  }

  const { drag, dropIndex, swipe, onPointerDown, shouldSuppressClick } = useBoardGestures({
    listRef,
    activeIndex,
    columnCount: statuses.length,
    allowReorder: !allMonths,
    onSwitchColumn: setColumnIndex,
    onSwipeMove: (id, target) => {
      void changeStatus(id, statuses[target].id)
    },
    /* 非表示の繰り返し回も順位を持つため、カード数と保存先の位置は一致しない。 */
    onDrop: (id, col, index) => {
      const status = statuses[col]
      if (!status) return
      const latest = currentWork(useDataStore.getState().issues).filter((issue) => issueMonth(issue) === month)
      const visibleKeys = new Set(selectBoardGroups(latest, doneIds, month, false, filter).map(group => group.key))
      void move(id, col, groupedDropIndex(latest, doneIds, id, status.id, index, visibleKeys))
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
        <p className="px-4 pb-4 text-[11px] text-muted">対象月の集計です。検索・絞り込み・全月表示は反映しません。親タスク・epic・持ち越し済みの履歴を除いて数えます。</p>
      </details>

      <div role="search" className="flex min-w-0 flex-col gap-2">
        <input type="search" aria-label="タスクを検索" placeholder="タイトル・番号・ラベルで検索" className={FIELD_CLASS} value={filter.query} onChange={(event) => setFilter({ ...filter, query: event.target.value })} />
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <select aria-label="優先度で絞り込み" className={`${FIELD_CLASS} min-w-0`} value={filter.priority} onChange={(event) => setFilter({ ...filter, priority: event.target.value as Priority | 'all' })}>
            <option value="all">優先度: すべて</option>{PRIORITIES.map(priority => <option key={priority} value={priority}>{PRIORITY_LABELS[priority]}</option>)}
          </select>
          <select aria-label="種別で絞り込み" className={`${FIELD_CLASS} min-w-0`} value={filter.type} onChange={(event) => setFilter({ ...filter, type: event.target.value as IssueType | 'all' })}>
            <option value="all">種別: すべて</option>{ISSUE_TYPES.map(type => <option key={type}>{type}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-2">
          <label className="flex min-h-11 items-center gap-2 text-xs text-muted"><input type="checkbox" checked={allMonths} onChange={(event) => setAllMonths(event.target.checked)} />すべての月のタスクを表示</label>
          <button type="button" className="min-h-11 rounded-lg border border-border px-3 text-xs disabled:opacity-40" disabled={!isFilterActive(filter)} onClick={() => setFilter(EMPTY_FILTER)}>クリア</button>
        </div>
      </div>

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

      <div role="status" className="text-xs text-muted">
        <p>{active.name}：{column.length}件表示 / 全ステータス：{groups.length}件</p>
        <p>繰り返し各回を含む{taskCount}タスク · {allMonths ? 'すべての月' : month}{isFilterActive(filter) ? ' · 絞り込み中' : ''}</p>
      </div>
      <p className="text-[11px] text-muted">各列の件数はカード数です。繰り返しは月ごとに1枚へまとめ、次の未完了のステータスに表示します。</p>
      {allMonths && <p className="text-[11px] text-muted">全月表示でも横スワイプでステータスを変更できます。並べ替えは対象月表示で行えます。</p>}

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
            {isFilterActive(filter) ? 'この列に検索条件に合うタスクはありません。ほかのステータスも確認できます。' : 'この列にタスクはありません。右下の＋から作成できます。'}
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
              {allMonths && <span className="mb-1 block text-[11px] text-muted">対象月：{issueMonth(issue)}</span>}
              <RecurringBoardCard
                group={group}
                relatedIssues={allIssues}
                rule={recurrenceRules.find((rule) => rule.id === issue.recurrenceId)}
                statuses={statuses}
                doneIds={doneIds}
                pulse={group.occurrences.some((occurrence) => occurrence.id === pulseId)}
                onOpen={setEditing}
                onToggleDone={toggleDone}
                onChangeStatus={changeStatus}
                onMove={setMoving}
              />
            </li>
          }
          const isDragged = drag?.issueId === issue.id
          const swipeHere = swipe?.issueId === issue.id ? swipe : null
          return (
            <li key={group.key}>
              {allMonths && <span className="mb-1 block text-[11px] text-muted">対象月：{issueMonth(issue)}</span>}
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
                onMove={() => setMoving(issue)}
              />
              <CarryoverTrail issue={issue} issues={allIssues} onOpen={setEditing} />
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
      {moving && <MoveSheet key={moving.id} issue={moving} onClose={() => setMoving(null)} />}
    </section>
  )
}
