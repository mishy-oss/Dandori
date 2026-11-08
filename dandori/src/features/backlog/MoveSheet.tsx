import { useState } from 'react'
import { Sheet } from '../../app/Sheet'
import type { Issue, Sprint } from '../../db/types'
import { formatIssueNumber } from '../../lib/issueNumber'
import { useDataStore } from '../../store/data'

/** 移動対象のIssueと、バックログ・完了していないスプリントの候補を選択ダイアログに表示する。 */
export function MoveSheet({
  issue,
  sprints,
  onClose,
}: {
  issue: Issue
  sprints: Sprint[]
  onClose: () => void
}) {
  const assign = useDataStore(/* ストアからassignIssueToSprint（保存・状態変更の操作）を取得する。 */ (s) => s.assignIssueToSprint)
  const [error, setError] = useState<string | null>(null)

  /** Issueを選択したスプリントまたはバックログへ移動し、成功時に移動先選択を閉じる。 */
  async function move(sprintId: string | null) {
    try {
      await assign(issue.id, sprintId)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const targets = sprints.filter(/* 完了済み以外という条件を満たす要素だけを残す。 */ (s) => s.state !== 'closed')

  return (
    <Sheet label="移動先を選択" onClose={onClose}>
      <h2 className="text-lg font-bold">
        {formatIssueNumber(issue.number)} の移動先
      </h2>
      <p className="-mt-2 truncate text-sm text-muted">{issue.title}</p>
      <ul className="flex flex-col gap-2">
        <li>
          <button
            disabled={issue.sprintId === null}
            onClick={/* 選択した移動先へIssueを移す処理を呼び出す。 */ () => void move(null)}
            className="min-h-11 w-full rounded-lg border border-border px-3 text-left disabled:opacity-40"
          >
            バックログ
          </button>
        </li>
        {targets.map(/* 各移動先スプリントの表示要素を作り、対応する選択・編集操作を結び付ける。 */ (s) => (
          <li key={s.id}>
            <button
              disabled={issue.sprintId === s.id}
              onClick={/* 選択した移動先へIssueを移す処理を呼び出す。 */ () => void move(s.id)}
              className="min-h-11 w-full rounded-lg border border-border px-3 text-left disabled:opacity-40"
            >
              {s.name}
              <span className="ml-2 text-xs text-muted">
                {s.state === 'active' ? 'アクティブ' : '計画中'} · {s.startDate} 〜 {s.endDate}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}
      <button className="min-h-11 rounded-lg border border-border text-sm" onClick={onClose}>
        キャンセル
      </button>
    </Sheet>
  )
}
