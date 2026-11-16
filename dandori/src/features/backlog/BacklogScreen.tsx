import { useMemo, useState } from 'react'
import { FIELD_CLASS } from '../../app/fields'
import { Screen } from '../../app/Screen'
import { ISSUE_TYPES, PRIORITIES, PRIORITY_LABELS, type Issue, type IssueType, type Priority } from '../../db/types'
import { selectCurrentProject, useDataStore } from '../../store/data'
import { issueMonth } from '../../lib/month'
import { IssueEditor } from '../issue-editor/IssueEditor'
import { MonthNavigator } from '../monthly/MonthNavigator'
import { MonthlyBurndown } from '../monthly/MonthlyBurndown'
import { BacklogRow } from './BacklogRow'
import { EMPTY_FILTER, isFilterActive, matchesFilter, type IssueFilter } from './filters'
import { MoveSheet } from './MoveSheet'
import { groupBoardIssues } from '../board/recurringGroups'
import { RecurringBoardCard } from '../board/RecurringBoardCard'

export function BacklogScreen() {
  const project = useDataStore(selectCurrentProject)
  const issues = useDataStore((state) => state.issues)
  const month = useDataStore((state) => state.selectedMonth)
  const workflows = useDataStore((state) => state.workflows)
  const ready = useDataStore((state) => state.ready)
  const toggleDone = useDataStore((state) => state.toggleIssueDone)
  const updateIssue = useDataStore((state) => state.updateIssue)
  const recurrenceRules = useDataStore((state) => state.recurrenceRules)
  const [filter, setFilter] = useState<IssueFilter>(EMPTY_FILTER)
  const [allMonths, setAllMonths] = useState(false)
  const [editing, setEditing] = useState<Issue | 'new' | null>(null)
  const [moving, setMoving] = useState<Issue | null>(null)
  const [error, setError] = useState<string | null>(null)
  const statuses = project ? workflows[project.workflowId]?.statuses ?? [] : []
  const doneIds = new Set(statuses.filter((status) => status.category === 'done').map((status) => status.id))
  const scoped = useMemo(() => issues.filter((issue) => allMonths || issueMonth(issue) === month), [issues, allMonths, month])
  // 一覧をまとめた後で検索し、該当したカードの各回と完了数が欠けないようにする。
  const visible = groupBoardIssues(scoped, doneIds).filter((group) => group.occurrences.some((issue) => matchesFilter(issue, filter)))
  const taskCount = visible.reduce((total, group) => total + group.occurrences.length, 0)

  async function toggle(id: string) {
    setError(null)
    try { await toggleDone(id) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  async function changeStatus(id: string, statusId: string) {
    setError(null)
    try { await updateIssue(id, { statusId }) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  if (!ready || !project) return null
  return <Screen title="タスク">
    <MonthNavigator />
    <MonthlyBurndown />
    <p className="text-[11px] text-muted">月末の未完了タスクは翌月へ自動で繰り越します。</p>
    <div role="search" className="flex flex-col gap-2">
      <input type="search" aria-label="タスクを検索" placeholder="タイトル・番号・ラベルで検索" className={FIELD_CLASS} value={filter.query} onChange={(event) => setFilter({ ...filter, query: event.target.value })} />
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
        <select aria-label="優先度で絞り込み" className={FIELD_CLASS} value={filter.priority} onChange={(event) => setFilter({ ...filter, priority: event.target.value as Priority | 'all' })}><option value="all">優先度: すべて</option>{PRIORITIES.map((priority) => <option key={priority} value={priority}>{PRIORITY_LABELS[priority]}</option>)}</select>
        <select aria-label="種別で絞り込み" className={FIELD_CLASS} value={filter.type} onChange={(event) => setFilter({ ...filter, type: event.target.value as IssueType | 'all' })}><option value="all">種別: すべて</option>{ISSUE_TYPES.map((type) => <option key={type}>{type}</option>)}</select>
        <button type="button" className="min-h-11 rounded-lg border border-border px-3 text-xs" disabled={!isFilterActive(filter)} onClick={() => setFilter(EMPTY_FILTER)}>クリア</button>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-xs text-muted"><input type="checkbox" checked={allMonths} onChange={(event) => setAllMonths(event.target.checked)} />すべての月のタスクを表示</label>
    </div>
    {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
    <p className="text-xs text-muted">{visible.length}件表示 / {taskCount}タスク{allMonths ? ' · すべての月' : ` · ${month}`}</p>
    {visible.length === 0 ? <p className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted">タスクがありません。右下の＋から作成できます。</p> : <ul className="flex flex-col gap-2">
      {visible.map((group) => {
        const issue = group.issue
        if (group.recurring) return <li key={group.key}>
          {allMonths && <span className="mb-1 block text-[10px] text-muted">{issueMonth(issue)}</span>}
          <RecurringBoardCard group={group} rule={recurrenceRules.find((rule) => rule.id === issue.recurrenceId)}
            relatedIssues={issues} statuses={statuses} doneIds={doneIds} pulse={false} onOpen={setEditing} onToggleDone={toggle} onChangeStatus={changeStatus} />
        </li>
        const children = issues.filter((child) => child.parentId === issue.id)
        return <li key={group.key}>
          {allMonths && <span className="mb-1 block text-[10px] text-muted">{issueMonth(issue)}</span>}
          <BacklogRow issue={issue} done={doneIds.has(issue.statusId)} statusName={statuses.find((status) => status.id === issue.statusId)?.name ?? ''}
            parentIssue={issues.find((parent) => parent.id === issue.parentId)} childCount={children.length} childDoneCount={children.filter((child) => doneIds.has(child.statusId)).length}
            onOpen={() => setEditing(issue)} onMove={() => setMoving(issue)} onToggleDone={() => void toggle(issue.id)} />
        </li>
      })}
    </ul>}
    <button aria-label="Issueを作成" className="app-fab" onClick={() => setEditing('new')}>+</button>
    {editing && <IssueEditor key={editing === 'new' ? 'new' : editing.id} issue={editing === 'new' ? null : editing} defaultPlanningMonth={month} onClose={() => setEditing(null)} />}
    {moving && <MoveSheet key={moving.id} issue={moving} onClose={() => setMoving(null)} />}
  </Screen>
}
