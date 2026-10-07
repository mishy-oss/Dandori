import { useState } from 'react'
import { Sheet } from '../../app/Sheet'
import type { Issue, Sprint } from '../../db/types'
import { formatIssueNumber } from '../../lib/issueNumber'
import { useDataStore } from '../../store/data'

export function MoveSheet({
  issue,
  sprints,
  onClose,
}: {
  issue: Issue
  sprints: Sprint[]
  onClose: () => void
}) {
  const assign = useDataStore((s) => s.assignIssueToSprint)
  const [error, setError] = useState<string | null>(null)

  async function move(sprintId: string | null) {
    try {
      await assign(issue.id, sprintId)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const targets = sprints.filter((s) => s.state !== 'closed')

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
            onClick={() => void move(null)}
            className="min-h-11 w-full rounded-lg border border-border px-3 text-left disabled:opacity-40"
          >
            バックログ
          </button>
        </li>
        {targets.map((s) => (
          <li key={s.id}>
            <button
              disabled={issue.sprintId === s.id}
              onClick={() => void move(s.id)}
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
