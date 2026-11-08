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

/** スプリントごとのIssueとバックログを表示し、検索・絞り込み・Issue編集・スプリント管理の操作を受け付ける。 */
export function BacklogScreen() {
  const project = useDataStore(selectCurrentProject)
  const issues = useDataStore(/* ストアからIssueを取得する。 */ (s) => s.issues)
  const sprints = useDataStore(/* ストアからスプリントを取得する。 */ (s) => s.sprints)
  const workflow = useDataStore(/* 現在のプロジェクトに対応するワークフローをストアから取得する。 */ (s) => (project ? s.workflows[project.workflowId] : undefined))
  const ready = useDataStore(/* ストアから初期化の完了状態を取得する。 */ (s) => s.ready)
  const startSprint = useDataStore(/* ストアからstartSprint（保存・状態変更の操作）を取得する。 */ (s) => s.startSprint)
  const deleteSprint = useDataStore(/* ストアからdeleteSprint（保存・状態変更の操作）を取得する。 */ (s) => s.deleteSprint)
  const toggleIssueDone = useDataStore(/* ストアからtoggleIssueDone（保存・状態変更の操作）を取得する。 */ (s) => s.toggleIssueDone)

  const [filter, setFilter] = useState<IssueFilter>(EMPTY_FILTER)
  const [showClosed, setShowClosed] = useState(false)
  const [editing, setEditing] = useState<Issue | 'new' | null>(null)
  const [moving, setMoving] = useState<Issue | null>(null)
  const [sprintForm, setSprintForm] = useState<Sprint | 'new' | null>(null)
  const [completing, setCompleting] = useState<Sprint | null>(null)
  const [error, setError] = useState<string | null>(null)

  /** 完了カテゴリのステータスIDを集合にし、各Issueの完了判定に使う。 */
  const doneIds = useMemo(
    () => new Set((workflow?.statuses ?? []).filter(/* 完了カテゴリという条件を満たす要素だけを残す。 */ (s) => s.category === 'done').map(/* 各要素からIDだけを取り出す。 */ (s) => s.id)),
    [workflow],
  )
  /** 一覧で子Issue数や完了数を表示できるよう、Issueを親IDごとのMapへまとめる。 */
  const childrenByParent = useMemo(() => {
    const result = new Map<string, Issue[]>()
    for (const issue of issues) {
      if (!issue.parentId) continue
      result.set(issue.parentId, [...(result.get(issue.parentId) ?? []), issue])
    }
    return result
  }, [issues])

  if (!ready || !project) return null

  /** ステータスIDから画面表示用の名前を求め、見つからなければ空文字を返す。 */
  const statusName = (id: string) => workflow?.statuses.find(/* 指定IDと一致という条件を最初に満たす要素を探す。 */ (s) => s.id === id)?.name ?? ''
  /** 現在画面で選択されている検索条件にIssueが一致するかを判定する。 */
  const match = (i: Issue) => matchesFilter(i, filter)
  const filtered = isFilterActive(filter)
  const visibleSprints = sprints
    .filter(/* 完了済みの表示が有効なら全件を残し、無効なら完了済みスプリントを除外する。 */ (s) => showClosed || s.state !== 'closed')
    .sort(/* アクティブ・計画中・完了の順になるようスプリントの状態を比較する。 */ (a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state])
  const closedCount = sprints.filter(/* 完了済みスプリントという条件を満たす要素だけを残す。 */ (s) => s.state === 'closed').length
  const backlog = issues.filter(/* 指定スプリントまたはバックログと一致という条件を満たす要素だけを残す。 */ (i) => i.sprintId === null)
  const backlogVisible = backlog.filter(match)

  /** 操作前のエラーを消して指定された保存処理を実行し、失敗時はその理由を画面に表示する。 */
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
          onClick={/* 新規スプリントの作成画面を開く。 */ () => setSprintForm('new')}
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
          onChange={/* 入力された値に合わせて検索条件を更新する。 */ (e) => setFilter({ ...filter, query: e.target.value })}
        />
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <select
            aria-label="優先度で絞り込み"
            className={FIELD_CLASS}
            value={filter.priority}
            onChange={/* 入力された値に合わせて検索条件を更新する。 */ (e) => setFilter({ ...filter, priority: e.target.value as Priority | 'all' })}
          >
            <option value="all">優先度: すべて</option>
            {PRIORITIES.map(/* 各優先度の選択肢の表示要素を作り、対応する選択・編集操作を結び付ける。 */ (p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <select
            aria-label="種別で絞り込み"
            className={FIELD_CLASS}
            value={filter.type}
            onChange={/* 入力された値に合わせて検索条件を更新する。 */ (e) => setFilter({ ...filter, type: e.target.value as IssueType | 'all' })}
          >
            <option value="all">種別: すべて</option>
            {ISSUE_TYPES.map(/* 各Issueの種別の表示要素を作り、対応する選択・編集操作を結び付ける。 */ (t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <button
            disabled={!filtered}
            onClick={/* 操作内容に合わせて検索条件を更新する。 */ () => setFilter(EMPTY_FILTER)}
            className="min-h-11 rounded-lg border border-border px-3 text-sm disabled:opacity-40"
          >
            クリア
          </button>
        </div>
        {closedCount > 0 && (
          <label className="flex min-h-11 items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={showClosed} onChange={/* 入力された値に合わせて完了済みスプリントの表示設定を更新する。 */ (e) => setShowClosed(e.target.checked)} />
            完了したスプリントを表示({closedCount})
          </label>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-500 p-3 text-sm text-red-500">
          {error}
        </p>
      )}

      {visibleSprints.map(/* 各表示するスプリントの表示要素を作り、対応する選択・編集操作を結び付ける。 */ (s) => {
        const inSprint = issues.filter(/* 指定スプリントまたはバックログと一致という条件を満たす要素だけを残す。 */ (i) => i.sprintId === s.id)
        return (
          <SprintSection
            key={s.id}
            sprint={s}
            issues={inSprint.filter(match)}
          allIssues={issues}
            allCount={inSprint.length}
            doneCount={inSprint.filter(/* 完了という条件を満たす要素だけを残す。 */ (i) => doneIds.has(i.statusId)).length}
            estimateMin={inSprint.reduce(/* 見積時間を加算し、未設定の見積は0分として合計する。 */ (sum, i) => sum + (i.estimateMin ?? 0), 0)}
            filtered={filtered}
            doneIds={doneIds}
            statusName={statusName}
            onOpen={setEditing}
            onMove={setMoving}
            onToggleDone={/* 完了状態の切替を共通のエラー処理付きで実行する。 */ (i) => void run(/* 対象Issueの完了・未完了状態を切り替える処理を呼び出す。 */ () => toggleIssueDone(i.id))}
            onStart={/* 選択したスプリントの開始を共通のエラー処理付きで実行する。 */ () => void run(/* 選択したスプリントの開始処理を呼び出す。 */ () => startSprint(s.id))}
            onComplete={/* 対象スプリントの完了画面を開く。 */ () => setCompleting(s)}
            onEdit={/* 対象スプリントの編集画面を開く。 */ () => setSprintForm(s)}
            onDelete={/* 確認後、対象スプリントの削除を共通のエラー処理付きで実行する。 */ () => {
              if (confirm(`「${s.name}」を削除しますか?(中のIssueはバックログへ戻ります)`)) {
                void run(/* 指定されたスプリントを削除し、所属Issueをバックログへ戻す処理を呼ぶ。 */ () => deleteSprint(s.id))
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
            {backlogVisible.map(/* 各検索後のバックログの表示要素を作り、対応する選択・編集操作を結び付ける。 */ (i) => {
              const children = childrenByParent.get(i.id) ?? []
              return <li key={i.id}>
                <BacklogRow
                  issue={i}
                  done={doneIds.has(i.statusId)}
                  statusName={statusName(i.statusId)}
                  parentIssue={i.parentId ? issues.find(/* 指定IDと一致という条件を最初に満たす要素を探す。 */ (parent) => parent.id === i.parentId) : undefined}
                  childCount={children.length}
                  childDoneCount={children.filter(/* 完了という条件を満たす要素だけを残す。 */ (child) => doneIds.has(child.statusId)).length}
                  onOpen={/* 対象Issueの編集画面を開く。 */ () => setEditing(i)}
                  onMove={/* 対象Issueの移動先選択画面を開く。 */ () => setMoving(i)}
                  onToggleDone={/* 完了状態の切替を共通のエラー処理付きで実行する。 */ () => void run(/* 対象Issueの完了・未完了状態を切り替える処理を呼び出す。 */ () => toggleIssueDone(i.id))}
                />
              </li>
            })}
          </ul>
        )}
      </section>

      <button
        aria-label="Issueを作成"
        onClick={/* 新規Issueの作成画面を開く。 */ () => setEditing('new')}
        className="fixed right-4 z-30 flex size-14 items-center justify-center rounded-full bg-accent text-3xl text-accent-text shadow-lg"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 72px)' }}
      >
        +
      </button>

      {editing && (
        <IssueEditor
          key={editing === 'new' ? 'new' : editing.id}
          issue={editing === 'new' ? null : editing}
          onClose={/* Issue編集画面を閉じる。 */ () => setEditing(null)}
        />
      )}
      {moving && (
        <MoveSheet
          key={moving.id}
          issue={moving}
          sprints={sprints}
          onClose={/* 移動先選択画面を閉じる。 */ () => setMoving(null)}
        />
      )}
      {sprintForm && (
        <SprintFormSheet
          key={sprintForm === 'new' ? 'new' : sprintForm.id}
          sprint={sprintForm === 'new' ? null : sprintForm}
          onClose={/* スプリント編集画面を閉じる。 */ () => setSprintForm(null)}
        />
      )}
      {completing && <CompleteSprintDialog sprint={completing} onClose={/* スプリント完了画面を閉じる。 */ () => setCompleting(null)} />}
    </Screen>
  )
}
