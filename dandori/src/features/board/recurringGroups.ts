import type { Issue } from '../../db/types'
import { compareRank } from '../../lib/rank'

export interface BoardIssueGroup {
  key: string
  issue: Issue
  occurrences: Issue[]
  recurring: boolean
}

/** 日付、開始時刻、採番順で各回を並べる。未配置の回は日付がある回より後にする。 */
export function compareOccurrences(a: Issue, b: Issue): number {
  return (a.date ?? '9999-12-31').localeCompare(b.date ?? '9999-12-31') ||
    (a.startMin ?? 1440) - (b.startMin ?? 1440) || a.number - b.number
}

/** 同じプロジェクト・対象月・繰り返しルールのIssueをまとめ、最も早い未完了回を代表にする。移行前データのみ旧所属で区別する。 */
export function groupBoardIssues(issues: Issue[], doneIds: Set<string>): BoardIssueGroup[] {
  const groups = new Map<string, BoardIssueGroup>()
  for (const issue of issues) {
    if (issue.deletedAt !== null) continue
    const key = JSON.stringify(issue.recurrenceId
      ? ['recurrence', issue.projectId, issue.planningMonth ?? issue.sprintId, issue.recurrenceId]
      : ['issue', issue.id])
    const group = groups.get(key)
    if (group) group.occurrences.push(issue)
    else groups.set(key, { key, issue, occurrences: [issue], recurring: issue.recurrenceId !== null })
  }
  for (const group of groups.values()) {
    group.occurrences.sort(compareOccurrences)
    group.issue = group.occurrences.find(/* 次の未完了回のステータスをカードの所属列に使う。 */ (issue) => !doneIds.has(issue.statusId)) ?? group.occurrences[0]
  }
  return [...groups.values()].sort(/* 代表Issueの保存済みの順位に従ってカードを並べる。 */ (a, b) => compareRank(a.issue, b.issue))
}

/** グループ化後の見た目の挿入位置を、保存処理が扱う実Issue列内の挿入位置へ変換する。 */
export function groupedDropIndex(issues: Issue[], doneIds: Set<string>, movingId: string, statusId: string, index: number): number {
  const remaining = issues.filter(/* 移動対象自身は挿入位置の計算から除く。 */ (issue) => issue.id !== movingId && issue.deletedAt === null)
  const column = remaining.filter(/* 保存先列の実Issueを取得する。 */ (issue) => issue.statusId === statusId).sort(compareRank)
  const visible = groupBoardIssues(remaining, doneIds).filter(/* 保存先に表示されるカードだけを取り出す。 */ (group) => group.issue.statusId === statusId)
  const anchor = visible[Math.max(0, index)]
  if (!anchor) return column.length
  return column.findIndex(/* 次の表示カードの代表Issueの直前へ挿入する。 */ (issue) => issue.id === anchor.issue.id)
}
