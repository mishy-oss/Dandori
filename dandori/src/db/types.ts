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
