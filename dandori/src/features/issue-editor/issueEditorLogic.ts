import type { WorkflowStatus } from '../../db/types'

/* 既存ラベルにカンマを含められるため、区切り文字では分割しない。 */
export function appendIssueLabel(labels: string[], input: string): string[] {
  const label = input.trim()
  if (!label || labels.includes(label)) return labels
  return [...labels, label]
}

/* タイトルなどの編集で手動の状態を上書きしないよう、日時の配置・変更だけを自動変更の対象にする。 */
export function scheduledEditorStatusId(
  statuses: WorkflowStatus[],
  statusId: string,
  date: string | null,
  startMin: number | null,
  scheduleChanged: boolean,
): string {
  if (!scheduleChanged || date === null || startMin === null) return statusId
  const selected = statuses.find((status) => status.id === statusId)
  if (selected?.category !== 'todo') return statusId
  return statuses.find((status) => status.category === 'doing')?.id ?? statusId
}
