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
