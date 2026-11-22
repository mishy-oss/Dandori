import type { Issue, MonthlySnapshot, Project, RecurrenceRule, Settings, Sprint, Workflow } from '../../db/types'
import { DEFAULT_SETTINGS, ISSUE_TYPES, PRIORITIES } from '../../db/types'

export interface SyncData {
  projects: Project[]
  workflows: Workflow[]
  issues: Issue[]
  recurrenceRules: RecurrenceRule[]
  sprints: Sprint[]
  settings: Settings[]
  monthlySnapshots: MonthlySnapshot[]
}
export interface SyncDocument { revision: number; data: SyncData }
export interface PendingAccountRestore {
  id: string
  accountId: string
  expectedRevision: number
  target: SyncData
  theme: 'system' | 'light' | 'dark'
  retryStarted?: boolean
}
export const SYNC_TABLES = ['projects', 'workflows', 'issues', 'recurrenceRules', 'sprints', 'settings', 'monthlySnapshots'] as const
export type ConflictChoice = 'local' | 'remote'
export const MAX_SYNC_BYTES = 1_000_000

export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a, (_, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value) ===
    JSON.stringify(b, (_, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)
}

export function initialSyncData(timestamp = Date.now()): SyncData {
  return {
    projects: [{ id: 'account-project', key: 'TASK', name: 'Dandori', color: '#38bdf8', workflowId: 'account-workflow', nextNumber: 1, createdAt: timestamp, updatedAt: timestamp, deletedAt: null }],
    workflows: [{ id: 'account-workflow', statuses: [
      { id: 'account-todo', name: 'To Do', category: 'todo' },
      { id: 'account-doing', name: 'In Progress', category: 'doing' },
      { id: 'account-routine', name: 'Recurring', category: 'routine' },
      { id: 'account-done', name: 'Done', category: 'done' },
    ], createdAt: timestamp, updatedAt: timestamp, deletedAt: null }],
    issues: [], recurrenceRules: [], sprints: [], settings: [{ ...DEFAULT_SETTINGS }], monthlySnapshots: [],
  }
}

// 端末の時計では競合を決めず、前回同期時点から双方で変わった行だけを競合として扱う。
export function mergeSyncData(base: SyncData, local: SyncData, remote: SyncData, choice?: ConflictChoice) {
  const data = structuredClone(remote)
  const conflicts: string[] = []

  function preferLocalEdit<T>(previous: T, edited: T, cloud: T, label: string): boolean {
    if (sameValue(edited, previous) || sameValue(edited, cloud)) return false
    if (sameValue(cloud, previous)) return true
    conflicts.push(label)
    return choice === 'local'
  }

  // 初回同期時の作成日時や、タスク追加による採番の差は編集競合に含めない。
  const [project] = data.projects
  const [localProject] = local.projects
  const [baseProject] = base.projects
  for (const [field, label] of [['name', 'プロジェクト名'], ['color', 'プロジェクトの色']] as const) {
    if (preferLocalEdit(baseProject[field], localProject[field], project[field], label)) {
      project[field] = localProject[field]
      project.updatedAt = Math.max(project.updatedAt, localProject.updatedAt)
    }
  }
  const [workflow] = data.workflows
  const [localWorkflow] = local.workflows
  if (preferLocalEdit(base.workflows[0].statuses, localWorkflow.statuses, workflow.statuses, 'ワークフロー')) {
    workflow.statuses = structuredClone(localWorkflow.statuses)
    workflow.updatedAt = Math.max(workflow.updatedAt, localWorkflow.updatedAt)
  }

  for (const table of SYNC_TABLES) {
    if (table === 'projects' || table === 'workflows') continue
    const old = new Map<string, unknown>(base[table].map(row => [row.id, row]))
    const cloud = new Map<string, unknown>(data[table].map(row => [row.id, row]))
    for (const row of local[table]) {
      if (sameValue(row, old.get(row.id))) continue
      const current = cloud.get(row.id)
      if (!sameValue(current, old.get(row.id)) && !sameValue(current, row) && table !== 'monthlySnapshots') {
        conflicts.push(table === 'issues' ? (row as Issue).title : `${table}: ${row.id}`)
        if (!choice || choice === 'remote') continue
      }
      cloud.set(row.id, structuredClone(row))
    }
    Object.assign(data, { [table]: [...cloud.values()] })
  }
  // 2台がオフラインで同じ番号を採番できるため、統合後に重複分だけ新しい番号を割り当てる。
  const numbers = new Set<number>()
  let next = Math.max(1, ...data.issues.map(row => row.number + 1), ...local.projects.map(row => row.nextNumber), ...remote.projects.map(row => row.nextNumber))
  for (const issue of data.issues) {
    if (numbers.has(issue.number)) issue.number = next++
    numbers.add(issue.number)
  }
  project.nextNumber = next
  const statusConflicts = mergeStatusReferences(data, local, remote, choice)
  return { data, conflicts: [...conflicts, ...statusConflicts], statusConflicts }
}

function mergeStatusReferences(data: SyncData, local: SyncData, remote: SyncData, choice?: ConflictChoice): string[] {
  const workflow = data.workflows[0]
  const statuses = new Map(workflow.statuses.map(status => [status.id, status]))
  const missing = data.issues.filter(issue => !statuses.has(issue.statusId))
  const conflicts = missing.filter(issue => issue.deletedAt === null).map(issue => `ステータス参照（${issue.title}）`)
  if (!missing.length) return conflicts

  const preferred = choice === 'local' ? local : remote
  const preferredStatuses = new Map(preferred.workflows[0].statuses.map(status => [status.id, status]))
  const preferredIssues = new Map(preferred.issues.map(issue => [issue.id, issue]))
  const knownStatuses = new Map([...local.workflows[0].statuses, ...remote.workflows[0].statuses].map(status => [status.id, status]))
  if (choice) {
    for (const issue of missing) {
      const status = preferredStatuses.get(issue.statusId)
      if (issue.deletedAt !== null || !status || statuses.has(status.id)) continue
      const kept = structuredClone(status)
      workflow.statuses.push(kept)
      statuses.set(kept.id, kept)
    }
  }
  for (const issue of missing) {
    if (statuses.has(issue.statusId) || (!choice && issue.deletedAt === null)) continue
    const preferredStatusId = preferredIssues.get(issue.id)?.statusId
    const originalCategory = knownStatuses.get(issue.statusId)?.category
    // 削除を優先しても、独立して作られたタスクや削除済み記録は残す。
    const replacement = (preferredStatusId ? statuses.get(preferredStatusId) : undefined)
      ?? workflow.statuses.find(status => status.category === originalCategory)
      ?? workflow.statuses.find(status => status.category === 'todo')
    if (replacement) issue.statusId = replacement.id
  }
  return conflicts
}

export function importGuestData(guest: SyncData, account: SyncData): SyncData {
  const result = structuredClone(account)
  const project = result.projects[0]
  const statuses = result.workflows[0].statuses
  const existing = new Set(result.issues.map(issue => issue.id))
  const categories = new Map(guest.workflows.flatMap(workflow => workflow.statuses.map(status => [status.id, status.category] as const)))
  const rankPrefix = result.issues.at(-1)?.rank ?? 'a0'
  for (const issue of guest.issues) {
    if (existing.has(issue.id)) continue
    result.issues.push({ ...issue, projectId: project.id, number: project.nextNumber++, statusId: statuses.find(status => status.category === categories.get(issue.statusId))?.id ?? statuses[0].id,
      sprintId: null, legacySprintId: issue.legacySprintId ?? issue.sprintId ?? null, rank: issue.rank || rankPrefix })
  }
  const rules = new Set(result.recurrenceRules.map(rule => rule.id))
  result.recurrenceRules.push(...guest.recurrenceRules.filter(rule => !rules.has(rule.id)).map(rule => ({ ...rule, projectId: project.id })))
  const sprints = new Set(result.sprints.map(sprint => sprint.id))
  result.sprints.push(...guest.sprints.filter(sprint => !sprints.has(sprint.id)).map(sprint => ({ ...sprint, projectId: project.id })))
  const history = new Set(result.monthlySnapshots.map(snapshot => snapshot.date))
  result.monthlySnapshots.push(...guest.monthlySnapshots.filter(snapshot => !history.has(snapshot.date)).map(snapshot => ({ ...snapshot, id: `${project.id}:${snapshot.date}`, projectId: project.id })))
  return result
}

export function isSyncData(value: unknown): value is SyncData {
  if (!value || typeof value !== 'object') return false
  const data = value as SyncData
  const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9:_-]{1,160}$/.test(v)
  const text = (v: unknown, max = 20_000) => typeof v === 'string' && v.length <= max
  const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0
  const nullableNumber = (v: unknown) => v === null || finite(v)
  const nullableId = (v: unknown) => v === null || id(v)
  const date = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v
  try {
    if (!SYNC_TABLES.every(table => Array.isArray(data[table]) && data[table].length <= 10_000 && data[table].every(row => row && id(row.id)) && new Set(data[table].map(row => row.id)).size === data[table].length)) return false
    if (data.projects.length !== 1 || data.workflows.length !== 1 || data.settings.length !== 1) return false
    const project = data.projects[0], workflow = data.workflows[0]
    if (project.id !== 'account-project' || workflow.id !== 'account-workflow' || project.workflowId !== workflow.id || !finite(project.nextNumber) || !Array.isArray(workflow.statuses)) return false
    if (!['todo', 'doing', 'routine', 'done'].every(category => workflow.statuses.some(status => status.category === category)) || !workflow.statuses.every(status => id(status.id) && text(status.name, 100))) return false
    const statusIds = new Set(workflow.statuses.map(status => status.id)), issueIds = new Set(data.issues.map(issue => issue.id)), rules = new Set(data.recurrenceRules.map(rule => rule.id))
    const byId = new Map(data.issues.map(issue => [issue.id, issue]))
    if (!data.issues.every(row => {
      if (row.carryoverToId !== undefined && (!id(row.carryoverToId) || row.carryoverToId === row.id || byId.get(row.carryoverToId)?.carryoverFromId !== row.id)) return false
      if (row.carryoverFromId === undefined) return row.carryoverRootId === undefined && row.carryoverSequence === undefined
      const source = byId.get(row.carryoverFromId)
      return id(row.carryoverFromId) && source?.carryoverToId === row.id && row.carryoverRootId === (source.carryoverRootId ?? source.id) &&
        row.carryoverSequence === (source.carryoverSequence ?? 0) + 1
    })) return false
    if (!data.issues.every(row => row.projectId === project.id && Number.isInteger(row.number) && row.number > 0 && ISSUE_TYPES.includes(row.type) && PRIORITIES.includes(row.priority) && text(row.title, 1000) && (row.description === undefined || text(row.description)) && statusIds.has(row.statusId) && nullableId(row.parentId) && (!row.parentId || issueIds.has(row.parentId)) && Array.isArray(row.labels) && row.labels.length <= 100 && row.labels.every(label => text(label, 200)) && (row.date === null || date(row.date)) && (row.dueDate === null || date(row.dueDate)) && nullableNumber(row.startMin) && (row.startMin === null || (row.date !== null && row.startMin < 1440)) && finite(row.durationMin) && row.durationMin > 0 && row.durationMin <= 1440 && nullableNumber(row.deletedAt) && finite(row.updatedAt) && finite(row.createdAt) && text(row.rank, 200) && nullableId(row.recurrenceId) && (!row.recurrenceId || rules.has(row.recurrenceId)))) return false
    if (!data.recurrenceRules.every(row => row.projectId === project.id && ['daily','weekly','monthly'].includes(row.frequency) && Number.isInteger(row.interval) && row.interval > 0 && row.interval <= 1000 && date(row.startDate) && (row.endDate === null || date(row.endDate)) && typeof row.active === 'boolean' && (row.weekdays === undefined || (Array.isArray(row.weekdays) && row.weekdays.every(day => Number.isInteger(day) && day >= 0 && day <= 6))))) return false
    if (!data.issues.every(row => (row.recurrenceDate === undefined || date(row.recurrenceDate)) && (row.recurrenceSeriesId === undefined || id(row.recurrenceSeriesId)))) return false
    if (!data.recurrenceRules.every(row => {
      if (row.effectiveFrom !== undefined && !date(row.effectiveFrom)) return false
      if (row.seriesId !== undefined && !id(row.seriesId)) return false
      if (row.excludedDates !== undefined && (!Array.isArray(row.excludedDates) || row.excludedDates.length > 10_000 || !row.excludedDates.every(date))) return false
      const value = row.template
      return value === undefined || (value !== null && text(value.title, 1000) && (value.description === undefined || text(value.description)) &&
        ISSUE_TYPES.includes(value.type) && PRIORITIES.includes(value.priority) && nullableId(value.parentId) && (!value.parentId || issueIds.has(value.parentId)) &&
        Array.isArray(value.labels) && value.labels.length <= 100 && value.labels.every(label => text(label, 200)) &&
        (value.date === null || date(value.date)) && (value.dueDate === null || date(value.dueDate)) &&
        nullableNumber(value.startMin) && (value.startMin === null || Number.isInteger(value.startMin) && value.startMin < 1440) &&
        Number.isInteger(value.durationMin) && value.durationMin >= 5 && value.durationMin <= 1440 && (value.startMin === null || value.startMin + value.durationMin <= 1440) &&
        nullableNumber(value.reminderOffsetMin) && nullableNumber(value.estimateMin) && text(value.icon, 200) && text(value.color, 200) &&
        (value.isRoutine === undefined || typeof value.isRoutine === 'boolean') && (value.calendarAllDay === undefined || typeof value.calendarAllDay === 'boolean'))
    })) return false
    if (!data.sprints.every(row => row.projectId === project.id && date(row.startDate) && date(row.endDate) && Array.isArray(row.snapshots))) return false
    if (!data.monthlySnapshots.every(row => row.projectId === project.id && date(row.date) && finite(row.totalCount) && finite(row.remainingCount))) return false
    const settings = data.settings[0]
    return settings.id === 'main' && finite(settings.dayStartHour) && finite(settings.dayEndHour) && settings.dayStartHour < settings.dayEndHour && settings.dayEndHour <= 24 && finite(settings.defaultDuration) && settings.defaultDuration > 0 && settings.defaultDuration <= 1440 && [0,1].includes(settings.weekStartsOn) && nullableNumber(settings.lastBackupAt)
  } catch { return false }
}
