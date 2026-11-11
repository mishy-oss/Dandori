import type { WorkflowStatus } from '../../db/types'

/** フォームで日時を配置・変更した通常の未着手タスクを進行中にする。日時以外の編集や専用列は保持する。 */
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
