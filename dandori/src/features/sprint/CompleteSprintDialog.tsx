import { useMemo, useState } from 'react'
import { FIELD_CLASS } from '../../app/fields'
import { Sheet } from '../../app/Sheet'
import type { IncompleteIssuesAction } from '../../db/sprintRepo'
import type { Sprint } from '../../db/types'
import { selectCurrentProject, useDataStore } from '../../store/data'

type Choice = 'sprint' | 'new' | 'backlog'

/** スプリントの完了・未完了件数と、未完了Issueの持ち越し先を選ぶダイアログを表示する。 */
export function CompleteSprintDialog({ sprint, onClose }: { sprint: Sprint; onClose: () => void }) {
  const project = useDataStore(selectCurrentProject)
  const workflow = useDataStore(/* 現在のプロジェクトに対応するワークフローをストアから取得する。 */ (s) => (project ? s.workflows[project.workflowId] : undefined))
  const issues = useDataStore(/* ストアからIssueを取得する。 */ (s) => s.issues)
  const sprints = useDataStore(/* ストアからスプリントを取得する。 */ (s) => s.sprints)
  const completeSprint = useDataStore(/* ストアからcompleteSprint（保存・状態変更の操作）を取得する。 */ (s) => s.completeSprint)

  /** 計画中のスプリントを関連データから計算し、依存する値が変わるまで結果を再利用する。 */
  const planned = useMemo(() => sprints.filter(/* 計画中という条件を満たす要素だけを残す。 */ (s) => s.state === 'planned'), [sprints])
  /** スプリント内のIssueを完了ステータスで数え、完了件数と未完了件数を計算する。 */
  const { done, open } = useMemo(() => {
    const doneIds = new Set(
      (workflow?.statuses ?? []).filter(/* 完了カテゴリという条件を満たす要素だけを残す。 */ (s) => s.category === 'done').map(/* 各要素からIDだけを取り出す。 */ (s) => s.id),
    )
    const inSprint = issues.filter(/* 指定スプリントまたはバックログと一致という条件を満たす要素だけを残す。 */ (i) => i.sprintId === sprint.id)
    const doneCount = inSprint.filter(/* 完了という条件を満たす要素だけを残す。 */ (i) => doneIds.has(i.statusId)).length
    return { done: doneCount, open: inSprint.length - doneCount }
  }, [issues, workflow, sprint.id])

  const [choice, setChoice] = useState<Choice>(planned.length > 0 ? 'sprint' : 'new')
  const [nextId, setNextId] = useState(planned[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)

  /** 選択された未完了Issueの移動先を組み立ててスプリントを完了し、成功時にダイアログを閉じる。 */
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
            .filter(/* 非表示に指定されていないという条件を満たす要素だけを残す。 */ (o) => !o.hidden)
            .map(/* 各options
            .filter((o) => !o.hidden)の表示要素を作り、対応する選択・編集操作を結び付ける。 */ (o) => (
              <label key={o.value} className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3">
                <input
                  type="radio"
                  name="incomplete"
                  checked={choice === o.value}
                  onChange={/* 操作内容に合わせて未完了Issueの持ち越し方法を更新する。 */ () => setChoice(o.value)}
                />
                {o.label}
              </label>
            ))}
          {choice === 'sprint' && (
            <select
              aria-label="持ち越し先"
              className={FIELD_CLASS}
              value={nextId}
              onChange={/* 入力された値に合わせて持ち越し先スプリントを更新する。 */ (e) => setNextId(e.target.value)}
            >
              {planned.map(/* 各計画中のスプリントの表示要素を作り、対応する選択・編集操作を結び付ける。 */ (s) => (
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
          onClick={/* 選択した持ち越し方法でスプリントを完了する。 */ () => void submit()}
        >
          完了する
        </button>
      </div>
    </Sheet>
  )
}
