import type { ID } from '../lib/id'

export type { ID }

export type StatusCategory = 'todo' | 'doing' | 'done'

export interface WorkflowStatus {
  id: ID
  name: string
  category: StatusCategory
  wipLimit?: number
}

export interface Workflow {
  id: ID
  statuses: WorkflowStatus[]
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export interface Project {
  id: ID
  key: string
  name: string
  color: string
  workflowId: ID
  nextNumber: number
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export type IssueType = 'task' | 'bug' | 'story' | 'epic'
export type Priority = 'low' | 'medium' | 'high' | 'urgent'

export interface Issue {
  id: ID
  projectId: ID
  number: number
  type: IssueType
  title: string
  description?: string
  statusId: ID
  priority: Priority
  parentId: ID | null
  labels: string[]
  dueDate: string | null
  estimateMin: number | null
  sprintId: ID | null
  /** 月単位の計画対象。旧データは起動時に日付・期限・作成日から補う。 */
  planningMonth?: string
  /** 移行前の所属を保存し、既存のスプリント情報を失わないようにする。 */
  legacySprintId?: ID | null
  rank: string
  // スケジュール(タイムライン用)
  date: string | null
  startMin: number | null
  durationMin: number
  icon: string
  color: string
  reminderOffsetMin: number | null
  recurrenceId: ID | null
  assigneeId: ID | null
  completedAt: number | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly'

export interface RecurrenceRule {
  id: ID
  projectId: ID
  frequency: RecurrenceFrequency
  interval: number
  /** JavaScript weekday numbers: Sunday = 0 through Saturday = 6. */
  weekdays?: number[]
  startDate: string
  endDate: string | null
  active: boolean
  createdAt: number
  updatedAt: number
}

export const ISSUE_TYPES: IssueType[] = ['task', 'bug', 'story', 'epic']
export const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent']

export type SprintState = 'planned' | 'active' | 'closed'

// テーマは初回描画前に適用する必要があるため localStorage に保存し、ここには含めない
export interface Settings {
  id: 'main'
  dayStartHour: number
  dayEndHour: number
  defaultDuration: number
  weekStartsOn: 0 | 1
  lastBackupAt: number | null
}

export const DEFAULT_SETTINGS: Settings = {
  id: 'main',
  dayStartHour: 6,
  dayEndHour: 24,
  defaultDuration: 30,
  weekStartsOn: 1,
  lastBackupAt: null,
}

export interface SprintSnapshot {
  date: string
  remainingMin: number
  remainingCount: number
  /** Total sprint scope at the time of the snapshot; optional for existing stored snapshots. */
  totalMin?: number
  totalCount?: number
}

export interface MonthlySnapshot {
  id: string
  projectId: ID
  month: string
  date: string
  totalCount: number
  remainingCount: number
}

export interface Sprint {
  id: ID
  projectId: ID
  name: string
  goal?: string
  startDate: string
  endDate: string
  state: SprintState
  // バーンダウン用の日次スナップショット(記録はフェーズ5)
  snapshots: SprintSnapshot[]
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}
