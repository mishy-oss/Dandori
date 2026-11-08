import { useMemo, useState } from 'react'
import { FIELD_CLASS } from '../../app/fields'
import { Screen } from '../../app/Screen'
import { ISSUE_TYPES, PRIORITIES, type Issue, type IssueType, type Priority } from '../../db/types'
import { selectCurrentProject, useDataStore } from '../../store/data'
import { issueMonth } from '../../lib/month'
import { IssueEditor } from '../issue-editor/IssueEditor'
import { MonthNavigator } from '../monthly/MonthNavigator'
import { MonthlyBurndown } from '../monthly/MonthlyBurndown'
import { BacklogRow } from './BacklogRow'
import { EMPTY_FILTER, isFilterActive, matchesFilter, type IssueFilter } from './filters'
import { MoveSheet } from './MoveSheet'

/** 月別のバーンダウンとタスクを表示する。すべての月の検索、編集、対象月変更にも対応する。 */
export function BacklogScreen() {
  const project = useDataStore(selectCurrentProject)
  const issues = useDataStore(/* プロジェクトの全タスクを取得する。 */ (state) => state.issues)
  const month = useDataStore(/* 選択されている対象月を読む。 */ (state) => state.selectedMonth)
  const workflows = useDataStore(/* ステータス名と完了カテゴリに使う。 */ (state) => state.workflows)
  const ready = useDataStore(/* 初期化完了を確認する。 */ (state) => state.ready)
  const toggleDone = useDataStore(/* 各タスクの完了切替を取得する。 */ (state) => state.toggleIssueDone)
  const [filter, setFilter] = useState<IssueFilter>(EMPTY_FILTER)
  const [allMonths, setAllMonths] = useState(false)
  const [editing, setEditing] = useState<Issue | 'new' | null>(null)
  const [moving, setMoving] = useState<Issue | null>(null)
  const [error, setError] = useState<string | null>(null)
  const statuses = project ? workflows[project.workflowId]?.statuses ?? [] : []
  const doneIds = new Set(statuses.filter(/* 完了ステータスを集める。 */ (status) => status.category === 'done').map(/* IDで判定する集合にする。 */ (status) => status.id))
  const visible = useMemo(/* 月と検索条件の両方で絞り込む。 */ () => issues.filter(/* 条件に合うタスクを取り出す。 */ (issue) => (allMonths || issueMonth(issue) === month) && matchesFilter(issue, filter)), [issues, allMonths, month, filter])

  /** 完了切替に失敗した理由を画面へ表示する。 */
  async function toggle(id: string) {
    setError(null)
    try { await toggleDone(id) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  if (!ready || !project) return null
  return <Screen title="タスク">
    <MonthNavigator />
    <MonthlyBurndown />
    <p className="text-[11px] text-muted">月末の未完了タスクは翌月へ自動で繰り越します。</p>
    <div role="search" className="flex flex-col gap-2">
      <input type="search" aria-label="タスクを検索" placeholder="タイトル・番号・ラベルで検索" className={FIELD_CLASS} value={filter.query} onChange={/* 検索語を更新する。 */ (event) => setFilter({ ...filter, query: event.target.value })} />
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
        <select aria-label="優先度で絞り込み" className={FIELD_CLASS} value={filter.priority} onChange={/* 優先度の検索条件を更新する。 */ (event) => setFilter({ ...filter, priority: event.target.value as Priority | 'all' })}><option value="all">優先度: すべて</option>{PRIORITIES.map(/* 優先度の選択肢を作る。 */ (priority) => <option key={priority}>{priority}</option>)}</select>
        <select aria-label="種別で絞り込み" className={FIELD_CLASS} value={filter.type} onChange={/* 種別の検索条件を更新する。 */ (event) => setFilter({ ...filter, type: event.target.value as IssueType | 'all' })}><option value="all">種別: すべて</option>{ISSUE_TYPES.map(/* 種別の選択肢を作る。 */ (type) => <option key={type}>{type}</option>)}</select>
        <button type="button" className="min-h-11 rounded-lg border border-border px-3 text-xs" disabled={!isFilterActive(filter)} onClick={/* 検索条件を初期化する。 */ () => setFilter(EMPTY_FILTER)}>クリア</button>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-xs text-muted"><input type="checkbox" checked={allMonths} onChange={/* 過去月・未来月も含む一覧へ切り替える。 */ (event) => setAllMonths(event.target.checked)} />すべての月のタスクを表示</label>
    </div>
    {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
    <p className="text-xs text-muted">{visible.length}件{allMonths ? ' · すべての月' : ` · ${month}`}</p>
    {visible.length === 0 ? <p className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted">タスクがありません。右下の＋から作成できます。</p> : <ul className="flex flex-col gap-2">
      {visible.map(/* 各タスクの親子関係と編集・対象月変更の操作を表示する。 */ (issue) => {
        const children = issues.filter(/* 子タスクの進捗を求める。 */ (child) => child.parentId === issue.id)
        return <li key={issue.id}>
          {allMonths && <span className="mb-1 block text-[10px] text-muted">{issueMonth(issue)}</span>}
          <BacklogRow issue={issue} done={doneIds.has(issue.statusId)} statusName={statuses.find(/* 表示するステータス名を求める。 */ (status) => status.id === issue.statusId)?.name ?? ''}
            parentIssue={issues.find(/* 親タスクを取得する。 */ (parent) => parent.id === issue.parentId)} childCount={children.length} childDoneCount={children.filter(/* 完了した子を数える。 */ (child) => doneIds.has(child.statusId)).length}
            onOpen={/* このタスクを編集する。 */ () => setEditing(issue)} onMove={/* 対象月変更の画面を開く。 */ () => setMoving(issue)} onToggleDone={/* 完了状態を切り替える。 */ () => void toggle(issue.id)} />
        </li>
      })}
    </ul>}
    <button aria-label="Issueを作成" className="app-fab" onClick={/* 表示月の新規タスクを作成する。 */ () => setEditing('new')}>+</button>
    {editing && <IssueEditor key={editing === 'new' ? 'new' : editing.id} issue={editing === 'new' ? null : editing} defaultPlanningMonth={month} onClose={/* 編集画面を閉じる。 */ () => setEditing(null)} />}
    {moving && <MoveSheet key={moving.id} issue={moving} onClose={/* 対象月変更の画面を閉じる。 */ () => setMoving(null)} />}
  </Screen>
}