import type { Issue } from '../db/types'

export function columnIssues(issues: Issue[], statusId: string, sprintId?: string | null): Issue[] {
  return issues.filter(
    (i) => i.statusId === statusId && (sprintId === undefined || i.sprintId === sprintId),
  )
}

// 楽観的更新用。リポジトリの moveIssue と同じ位置(列内 index、自分自身を除く)へ移す
export function applyMove(
  issues: Issue[],
  id: string,
  statusId: string,
  index: number,
  sprintId?: string | null,
): Issue[] {
  const moving = issues.find((i) => i.id === id)
  if (!moving) return issues
  const rest = issues.filter((i) => i.id !== id)
  const col = columnIssues(rest, statusId, sprintId)
  const at = Math.max(0, Math.min(index, col.length))
  let pos: number
  if (at < col.length) pos = rest.indexOf(col[at])
  else if (col.length > 0) pos = rest.indexOf(col[col.length - 1]) + 1
  else pos = rest.length
  const next = rest.slice()
  next.splice(pos, 0, { ...moving, statusId })
  return next
}
