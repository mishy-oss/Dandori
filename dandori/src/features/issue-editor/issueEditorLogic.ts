import type { WorkflowStatus } from '../../db/types'
import { normalizeIssueLabels } from '../../lib/labels'

/* 既存ラベルにカンマを含められるため、区切り文字では分割しない。 */
export function appendIssueLabel(labels: string[], input: string, existing: string[] = []): string[] {
  return normalizeIssueLabels([...labels, input], existing)
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
