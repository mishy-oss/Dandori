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
import { groupBoardIssues } from '../board/recurringGroups'
import { RecurringBoardCard } from '../board/RecurringBoardCard'

/** 月別のバーンダウンとタスクを表示する。すべての月の検索、編集、対象月変更にも対応する。 */
export function BacklogScreen() {
  const project = useDataStore(selectCurrentProject)
  const issues = useDataStore(/* プロジェクトの全タスクを取得する。 */ (state) => state.issues)
  const month = useDataStore(/* 選択されている対象月を読む。 */ (state) => state.selectedMonth)
  const workflows = useDataStore(/* ステータス名と完了カテゴリに使う。 */ (state) => state.workflows)
  const ready = useDataStore(/* 初期化完了を確認する。 */ (state) => state.ready)
  const toggleDone = useDataStore(/* 各タスクの完了切替を取得する。 */ (state) => state.toggleIssueDone)
  const updateIssue = useDataStore(/* 展開した各回のステータスを保存する。 */ (state) => state.updateIssue)
  const recurrenceRules = useDataStore(/* カードに表示する頻度と間隔を取得する。 */ (state) => state.recurrenceRules)
  const [filter, setFilter] = useState<IssueFilter>(EMPTY_FILTER)
  const [allMonths, setAllMonths] = useState(false)
  const [editing, setEditing] = useState<Issue | 'new' | null>(null)
  const [moving, setMoving] = useState<Issue | null>(null)
  const [error, setError] = useState<string | null>(null)
  const statuses = project ? workflows[project.workflowId]?.statuses ?? [] : []
  const doneIds = new Set(statuses.filter(/* 完了ステータスを集める。 */ (status) => status.category === 'done').map(/* IDで判定する集合にする。 */ (status) => status.id))
  const scoped = useMemo(/* まず対象月で絞り、全月表示なら過去・未来も含める。 */ () => issues.filter(/* 表示対象の月に含まれるタスクを取り出す。 */ (issue) => allMonths || issueMonth(issue) === month), [issues, allMonths, month])
  // 一覧をまとめた後で検索し、該当したカードの各回と完了数が欠けないようにする。
  const visible = groupBoardIssues(scoped, doneIds).filter(/* どれか1回でも検索条件に一致すればグループ全体を表示する。 */ (group) => group.occurrences.some(/* 各回の番号やタイトルも検索対象にする。 */ (issue) => matchesFilter(issue, filter)))
  const taskCount = visible.reduce(/* カード枚数と実タスク数を分けて集計する。 */ (total, group) => total + group.occurrences.length, 0)

  /** 完了切替に失敗した理由を画面へ表示する。 */
  async function toggle(id: string) {
    setError(null)
    try { await toggleDone(id) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  /** 繰り返しの一覧で選んだ1回だけステータスを変更し、失敗した理由を表示する。 */
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
      <input type="search" aria-label="タスクを検索" placeholder="タイトル・番号・ラベルで検索" className={FIELD_CLASS} value={filter.query} onChange={/* 検索語を更新する。 */ (event) => setFilter({ ...filter, query: event.target.value })} />
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
        <select aria-label="優先度で絞り込み" className={FIELD_CLASS} value={filter.priority} onChange={/* 優先度の検索条件を更新する。 */ (event) => setFilter({ ...filter, priority: event.target.value as Priority | 'all' })}><option value="all">優先度: すべて</option>{PRIORITIES.map(/* 優先度の選択肢を作る。 */ (priority) => <option key={priority}>{priority}</option>)}</select>
        <select aria-label="種別で絞り込み" className={FIELD_CLASS} value={filter.type} onChange={/* 種別の検索条件を更新する。 */ (event) => setFilter({ ...filter, type: event.target.value as IssueType | 'all' })}><option value="all">種別: すべて</option>{ISSUE_TYPES.map(/* 種別の選択肢を作る。 */ (type) => <option key={type}>{type}</option>)}</select>
        <button type="button" className="min-h-11 rounded-lg border border-border px-3 text-xs" disabled={!isFilterActive(filter)} onClick={/* 検索条件を初期化する。 */ () => setFilter(EMPTY_FILTER)}>クリア</button>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-xs text-muted"><input type="checkbox" checked={allMonths} onChange={/* 過去月・未来月も含む一覧へ切り替える。 */ (event) => setAllMonths(event.target.checked)} />すべての月のタスクを表示</label>
    </div>
    {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
    <p className="text-xs text-muted">{visible.length}件表示 / {taskCount}タスク{allMonths ? ' · すべての月' : ` · ${month}`}</p>
    {visible.length === 0 ? <p className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted">タスクがありません。右下の＋から作成できます。</p> : <ul className="flex flex-col gap-2">
      {visible.map(/* 繰り返しは共通カード、通常タスクは従来の行として表示する。 */ (group) => {
        const issue = group.issue
        if (group.recurring) return <li key={group.key}>
          {allMonths && <span className="mb-1 block text-[10px] text-muted">{issueMonth(issue)}</span>}
          <RecurringBoardCard group={group} rule={recurrenceRules.find(/* 繰り返しカードの頻度を取得する。 */ (rule) => rule.id === issue.recurrenceId)}
            relatedIssues={issues} statuses={statuses} doneIds={doneIds} pulse={false} onOpen={setEditing} onToggleDone={toggle} onChangeStatus={changeStatus} />
        </li>
        const children = issues.filter(/* 子タスクの進捗を求める。 */ (child) => child.parentId === issue.id)
        return <li key={group.key}>
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
