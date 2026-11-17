import type { Issue } from '../../db/types'
export function fixtureIssue(patch: Partial<Issue> = {}): Issue {
  return { id: 'task-1', projectId: 'account-project', number: 1, title: '資料を作る', type: 'task', priority: 'medium', statusId: 'account-doing', parentId: null, labels: [], dueDate: null, estimateMin: null, sprintId: null, planningMonth: '2026-11', rank: 'a0', date: '2026-11-17', startMin: 540, durationMin: 30, icon: '', color: '#38bdf8', reminderOffsetMin: 0, recurrenceId: null, assigneeId: null, completedAt: null, createdAt: 1, updatedAt: 1, deletedAt: null, ...patch }
}
