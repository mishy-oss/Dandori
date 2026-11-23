import { inTransaction } from './transaction'
import { db } from './db'
import type { createBackup } from './backupRepo'
import { initialSyncData, isSyncData, sameValue, SYNC_TABLES, type SyncData } from '../features/account/syncModel'
import { isValidDateStr } from '../lib/date'
import { isValidMonth } from '../lib/month'
import { rankAfter } from '../lib/rank'

export type BackupFile = Awaited<ReturnType<typeof createBackup>>
export const MAX_BACKUP_BYTES = 20_000_000
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,160}$/.test(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const text = (value: unknown, max = 1000) => typeof value === 'string' && value.length <= max
const nullableNumber = (value: unknown) => value === null || finite(value)
const datedRow = (row: { createdAt: number; updatedAt: number; deletedAt: number | null }) => finite(row.createdAt) && finite(row.updatedAt) && nullableNumber(row.deletedAt)

export function isBackupData(value: unknown): value is SyncData {
  try {
    if (!value || typeof value !== 'object') return false
    const data = value as SyncData
    if (!SYNC_TABLES.every(name => Array.isArray(data[name]) && data[name].length <= 10_000 && data[name].every(row => row && validId(row.id)) && new Set(data[name].map(row => row.id)).size === data[name].length)) return false
    if (Object.keys(data).some(key => !SYNC_TABLES.includes(key as typeof SYNC_TABLES[number]))) return false
    if (!isSyncData({ ...initialSyncData(0), settings: data.settings })) return false
    const settings = data.settings[0]
    if (![settings.dayStartHour, settings.dayEndHour, settings.defaultDuration].every(Number.isInteger) || settings.dayEndHour - settings.dayStartHour < 1 || settings.defaultDuration < 5 || settings.defaultDuration > 480) return false
    const projects = new Map(data.projects.map(project => [project.id, project]))
    const workflows = new Map(data.workflows.map(workflow => [workflow.id, workflow]))
    if (!data.projects.every(project => datedRow(project) && text(project.key, 10) && text(project.name) && text(project.color, 200) && Number.isInteger(project.nextNumber) && project.nextNumber > 0 && workflows.has(project.workflowId))) return false
    if (!data.workflows.every(workflow => datedRow(workflow) && Array.isArray(workflow.statuses) && workflow.statuses.length <= 100 && new Set(workflow.statuses.map(status => status.id)).size === workflow.statuses.length && workflow.statuses.every(status => validId(status.id) && text(status.name, 100) && ['todo', 'doing', 'routine', 'done'].includes(status.category) && (status.wipLimit === undefined || finite(status.wipLimit))))) return false
    if (![...data.issues, ...data.recurrenceRules, ...data.sprints, ...data.monthlySnapshots].every(row => projects.has(row.projectId))) return false
    const issues = new Map(data.issues.map(issue => [issue.id, issue]))
    for (const issue of data.issues) {
      if (typeof issue.rank !== 'string' || !/^[A-Za-z][0-9A-Za-z]{1,199}$/.test(issue.rank)) return false
      rankAfter(issue.rank)
    }
    const sprints = new Map(data.sprints.map(sprint => [sprint.id, sprint]))
    if (!data.issues.every(issue => text(issue.icon, 200) && text(issue.color, 200) && nullableNumber(issue.reminderOffsetMin) && nullableNumber(issue.estimateMin) && nullableNumber(issue.completedAt) && (issue.assigneeId === null || validId(issue.assigneeId)) && (issue.sprintId === null || sprints.get(issue.sprintId)?.projectId === issue.projectId) && (issue.planningMonth === undefined || isValidMonth(issue.planningMonth)) && (issue.isRoutine === undefined || typeof issue.isRoutine === 'boolean') && (issue.calendarAllDay === undefined || typeof issue.calendarAllDay === 'boolean') && (issue.calendarReadOnly === undefined || typeof issue.calendarReadOnly === 'boolean') && (issue.calendarSource === undefined || text(issue.calendarSource, 1000)) && (issue.calendarSeriesId === undefined || text(issue.calendarSeriesId, 1000)))) return false
    if (!data.recurrenceRules.every(rule => finite(rule.createdAt) && finite(rule.updatedAt) && (rule.endDate === null || rule.endDate >= rule.startDate) && (!rule.weekdays || new Set(rule.weekdays).size === rule.weekdays.length))) return false
    if (!data.sprints.every(sprint => datedRow(sprint) && text(sprint.name) && ['planned', 'active', 'closed'].includes(sprint.state) && sprint.endDate >= sprint.startDate && Array.isArray(sprint.snapshots) && sprint.snapshots.length <= 10_000 && sprint.snapshots.every(snapshot => isValidDateStr(snapshot.date) && finite(snapshot.remainingMin) && finite(snapshot.remainingCount) && (snapshot.totalMin === undefined || finite(snapshot.totalMin)) && (snapshot.totalCount === undefined || finite(snapshot.totalCount))))) return false
    if (!data.monthlySnapshots.every(snapshot => isValidMonth(snapshot.month) && snapshot.date.startsWith(snapshot.month) && Number.isInteger(snapshot.totalCount) && Number.isInteger(snapshot.remainingCount) && snapshot.remainingCount <= snapshot.totalCount)) return false
    // 同期用の検証器はアカウント固定IDを前提とするため、各プロジェクトを検証用の形に写す。
    for (const project of data.projects) {
      const workflow = workflows.get(project.workflowId)!
      const mapped = {
        projects: [{ ...project, id: 'account-project', workflowId: 'account-workflow' }],
        workflows: [{ ...workflow, id: 'account-workflow' }], settings: data.settings,
        issues: data.issues.filter(row => row.projectId === project.id).map(row => ({ ...row, projectId: 'account-project' })),
        recurrenceRules: data.recurrenceRules.filter(row => row.projectId === project.id).map(row => ({ ...row, projectId: 'account-project' })),
        sprints: data.sprints.filter(row => row.projectId === project.id).map(row => ({ ...row, projectId: 'account-project' })),
        monthlySnapshots: data.monthlySnapshots.filter(row => row.projectId === project.id).map(row => ({ ...row, projectId: 'account-project' })),
      }
      if (!isSyncData(mapped)) return false
      const numbers = new Set(mapped.issues.map(issue => issue.number))
      if (numbers.size !== mapped.issues.length || project.nextNumber <= Math.max(0, ...numbers)) return false
    }
    const checked = new Set<string>()
    for (const issue of data.issues) {
      const path = new Set<string>()
      let current = issue
      while (!checked.has(current.id)) {
        if (path.has(current.id)) return false
        path.add(current.id)
        if (!current.parentId) break
        const parent = issues.get(current.parentId)
        if (!parent) return false
        current = parent
      }
      for (const id of path) checked.add(id)
    }
    return true
  } catch { return false }
}

export function parseBackup(source: string): BackupFile {
  if (new TextEncoder().encode(source).byteLength > MAX_BACKUP_BYTES) throw new Error('JSONファイルは20MB以下にしてください。')
  let value: unknown
  try { value = JSON.parse(source.replace(/^\uFEFF/u, '')) } catch { throw new Error('JSONを読み取れませんでした。Dandoriから保存したファイルを選んでください。') }
  const file = value as BackupFile | null
  if (!file || file.format !== 'dandori-backup' || file.formatVersion !== 1) throw new Error('対応していないバックアップ形式です。DandoriのバックアップJSONを選んでください。')
  if (!Number.isInteger(file.databaseVersion) || file.databaseVersion < 1 || file.databaseVersion > db.verno) throw new Error('このバックアップのデータバージョンには対応していません。アプリを更新してください。')
  if (!['light', 'dark', 'system'].includes(file.theme) || typeof file.exportedAt !== 'string' || !Number.isFinite(Date.parse(file.exportedAt)) || !isBackupData(file.data)) throw new Error('バックアップの内容が不正です。日付・設定・親子関係などを確認できなかったため、復元しませんでした。')
  return file
}

export async function replaceBackupData(backup: BackupFile, expected: SyncData): Promise<void> {
  const checked = parseBackup(JSON.stringify(backup))
  await inTransaction(db, 'rw', db.tables, async () => {
    const current = Object.fromEntries(await Promise.all(SYNC_TABLES.map(async name => [name, await db.table(name).toArray()])))
    if (!sameValue(current, expected)) throw new Error('確認中にデータが更新されました。JSONを選び直して、最新の状態で確認してください。')
    for (const name of SYNC_TABLES) {
      await db.table(name).clear()
      if (checked.data[name].length) await db.table(name).bulkPut(checked.data[name])
    }
    await db.accountSync.clear()
  })
}

export function accountBackupData(backup: SyncData, current: SyncData): SyncData {
  const result = structuredClone(backup)
  const targetProject = structuredClone(current.projects[0])
  const targetWorkflow = structuredClone(current.workflows[0])
  const projectById = new Map(backup.projects.map(project => [project.id, project]))
  const workflowById = new Map(backup.workflows.map(workflow => [workflow.id, workflow]))
  const numbers = new Set<number>()
  let nextNumber = Math.max(1, ...backup.issues.map(issue => issue.number + 1))
  for (const issue of result.issues) {
    const workflow = workflowById.get(projectById.get(issue.projectId)!.workflowId)!
    const category = workflow.statuses.find(status => status.id === issue.statusId)!.category
    issue.projectId = targetProject.id
    issue.statusId = targetWorkflow.statuses.find(status => status.category === category)!.id
    if (numbers.has(issue.number)) issue.number = nextNumber++
    numbers.add(issue.number)
  }
  targetProject.nextNumber = nextNumber
  result.projects = [targetProject]
  result.workflows = [targetWorkflow]
  result.recurrenceRules.forEach(rule => { rule.projectId = targetProject.id })
  result.sprints.forEach(sprint => { sprint.projectId = targetProject.id })
  const snapshots = new Map<string, SyncData['monthlySnapshots'][number]>()
  for (const snapshot of result.monthlySnapshots) {
    const existing = snapshots.get(snapshot.date)
    if (existing) { existing.totalCount += snapshot.totalCount; existing.remainingCount += snapshot.remainingCount }
    else snapshots.set(snapshot.date, { ...snapshot, id: `${targetProject.id}:${snapshot.date}`, projectId: targetProject.id })
  }
  result.monthlySnapshots = [...snapshots.values()]
  if (!isSyncData(result)) throw new Error('このバックアップをアカウント用のデータへ変換できませんでした。')
  return result
}
