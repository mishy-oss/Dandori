import { beforeEach, expect, it } from 'vitest'
import { db } from './db'
import { carryoverIssue } from './carryoverRepo'
import { createIssue, deleteIssue, getIssue, listIssues, moveIssue, updateIssue } from './issueRepo'
import { createProject, getWorkflow } from './projectRepo'
import { monthlyWork, prepareMonthlyProject } from './monthlyRepo'
import { currentWork, carryoverHistory } from '../lib/carryover'
import { groupBoardIssues } from '../features/board/recurringGroups'
import { readSyncData } from '../features/account/accountRepo'
import { initialSyncData, importGuestData, isSyncData, mergeSyncData } from '../features/account/syncModel'
import { createBackup } from './backupRepo'
import { editRecurringIssue } from './recurringEditRepo'

beforeEach(async () => {
  await Promise.all(db.tables.map(table => table.clear()))
})

async function setup() {
  const project = await createProject({ key: 'APP', name: 'App' })
  const workflow = (await getWorkflow(project.workflowId))!
  const done = workflow.statuses.find(status => status.category === 'done')!
  const source = await createIssue({ projectId: project.id, title: '資料作成', date: '2026-11-18', planningMonth: '2026-11', startMin: 990, durationMin: 75,
    description: '途中まで作業済み', labels: ['仕事'], priority: 'high', dueDate: '2026-11-20', reminderOffsetMin: 5 })
  return { project, workflow, source, done, doneIds: new Set([done.id]) }
}

it('keeps yesterday unchanged and counts only the current attempt before and after completion', async () => {
  const { project, source, done, doneIds } = await setup()
  const next = await carryoverIssue(source.id, { date: '2026-11-19', startMin: 600, durationMin: 45 })
  expect(await getIssue(source.id)).toMatchObject({ title: source.title, date: source.date, startMin: source.startMin, durationMin: source.durationMin, statusId: source.statusId, completedAt: null, carryoverToId: next.id })
  expect(next).toMatchObject({ date: '2026-11-19', startMin: 600, durationMin: 45, description: source.description, labels: source.labels, priority: source.priority, dueDate: source.dueDate, reminderOffsetMin: 5, carryoverFromId: source.id })
  let all = await listIssues(project.id)
  expect(monthlyWork(all, '2026-11', doneIds)).toEqual({ totalCount: 1, remainingCount: 1 })
  expect(groupBoardIssues(all, doneIds).map(group => group.issue.id)).toEqual([next.id])
  expect(carryoverHistory(next, all).map(issue => issue.id)).toEqual([source.id])
  await updateIssue(next.id, { statusId: done.id })
  all = await listIssues(project.id)
  expect(monthlyWork(all, '2026-11', doneIds)).toEqual({ totalCount: 1, remainingCount: 0 })
  expect((await getIssue(source.id))?.completedAt).toBeNull()
  await expect(updateIssue(source.id, { startMin: null })).rejects.toThrow('履歴')
  await expect(moveIssue(source.id, done.id, 0)).rejects.toThrow('履歴')
  await expect(deleteIssue(source.id)).rejects.toThrow('履歴')
})

it('is idempotent on double submission and keeps one current task through multiple carryovers', async () => {
  const { project, source } = await setup()
  const input = { date: '2026-11-19', startMin: null, durationMin: 60 }
  const [first, repeated] = await Promise.all([carryoverIssue(source.id, input), carryoverIssue(source.id, input)])
  expect(first.id).toBe(repeated.id)
  const latest = await carryoverIssue(first.id, { ...input, date: '2026-11-20' })
  const all = await listIssues(project.id)
  expect(all).toHaveLength(3)
  expect(currentWork(all).map(issue => issue.id)).toEqual([latest.id])
  expect(carryoverHistory(latest, all)).toHaveLength(2)
  await deleteIssue(latest.id)
  expect(currentWork(await listIssues(project.id))).toHaveLength(0)
  await expect(carryoverIssue(first.id, input)).rejects.toThrow('持ち越し済み')
})

it('copies unfinished descendants and reconnects them without changing the old parent history', async () => {
  const { project, source, done, doneIds } = await setup()
  const child = await createIssue({ projectId: project.id, title: '未完了の子', parentId: source.id })
  const grandchild = await createIssue({ projectId: project.id, title: '未完了の孫', parentId: child.id })
  const completed = await createIssue({ projectId: project.id, title: '完了した子', parentId: source.id, statusId: done.id })
  const parent = await carryoverIssue(source.id, { date: '2026-11-19', startMin: 600, durationMin: 60 })
  let all = await listIssues(project.id)
  const nextChild = all.find(issue => issue.carryoverFromId === child.id)!
  const nextGrandchild = all.find(issue => issue.carryoverFromId === grandchild.id)!
  expect(nextChild).toMatchObject({ parentId: parent.id, date: '2026-11-19', startMin: null })
  expect(nextGrandchild.parentId).toBe(nextChild.id)
  expect(all.some(issue => issue.carryoverFromId === completed.id)).toBe(false)
  await updateIssue(nextGrandchild.id, { statusId: done.id })
  expect((await getIssue(parent.id))?.statusId).toBe(done.id)
  expect((await getIssue(source.id))?.completedAt).toBeNull()
  expect((await getIssue(child.id))?.completedAt).toBeNull()
  all = await listIssues(project.id)
  expect(monthlyWork(all, '2026-11', doneIds).remainingCount).toBe(0)
  const account = importGuestData(await readSyncData(), initialSyncData())
  expect(isSyncData(account)).toBe(true)
})

it('preserves prior month snapshots and does not roll archived records into the new month', async () => {
  const { project, source, doneIds } = await setup()
  await updateIssue(source.id, { date: '2026-11-30' })
  await prepareMonthlyProject(project.id, '2026-11', '2026-11-30')
  const before = await db.monthlySnapshots.get(`${project.id}:2026-11-30`)
  const next = await carryoverIssue(source.id, { date: '2026-12-01', startMin: 600, durationMin: 30 })
  await prepareMonthlyProject(project.id, '2026-12', '2026-12-01')
  expect((await getIssue(source.id))?.planningMonth).toBe('2026-11')
  expect(await db.monthlySnapshots.get(`${project.id}:2026-11-30`)).toEqual(before)
  expect(monthlyWork(await listIssues(project.id), '2026-12', doneIds)).toEqual({ totalCount: 1, remainingCount: 1 })
  expect((await getIssue(next.id))?.date).toBe('2026-12-01')
})

it('keeps parent history intact when only the carried child changes month and is later completed', async () => {
  const { project, source, done, doneIds } = await setup()
  const child = await createIssue({ projectId: project.id, title: '未完了の子', parentId: source.id, date: '2026-11-30', planningMonth: '2026-11' })
  const target = await carryoverIssue(source.id, { date: '2026-11-30', startMin: 600, durationMin: 30 })
  const childTarget = (await listIssues(project.id)).find(issue => issue.carryoverFromId === child.id)!
  const archivedBefore = [await getIssue(source.id), await getIssue(child.id)]
  await updateIssue(childTarget.id, { planningMonth: '2027-01', date: null, startMin: null })
  await prepareMonthlyProject(project.id, '2026-12', '2026-12-01')
  expect((await getIssue(target.id))?.planningMonth).toBe('2026-12')
  expect(await getIssue(childTarget.id)).toMatchObject({ parentId: target.id, planningMonth: '2027-01' })
  await updateIssue(childTarget.id, { statusId: done.id })
  expect((await getIssue(target.id))?.statusId).toBe(done.id)
  await expect(deleteIssue(source.id)).rejects.toThrow('履歴')
  await prepareMonthlyProject(project.id, '2027-02', '2027-02-01')
  expect([await getIssue(source.id), await getIssue(child.id)]).toEqual(archivedBefore)
  const all = await listIssues(project.id)
  expect(monthlyWork(all, '2027-01', doneIds)).toEqual({ totalCount: 1, remainingCount: 0 })
  expect(monthlyWork(all, '2027-02', doneIds)).toEqual({ totalCount: 0, remainingCount: 0 })
})

it('carries one recurring occurrence without cloning its rule or contaminating future occurrences', async () => {
  const { project } = await setup()
  const recurring = await createIssue({ projectId: project.id, title: '定期作業', planningMonth: '2026-11', date: '2026-11-18', startMin: 600, recurrence: { frequency: 'daily', interval: 1 } })
  const next = await carryoverIssue(recurring.id, { date: '2026-11-19', startMin: 660, durationMin: 30 })
  expect(next.recurrenceId).toBeNull()
  await prepareMonthlyProject(project.id, '2026-12', '2026-11-19')
  const december = (await listIssues(project.id)).filter(issue => issue.date?.startsWith('2026-12'))
  expect(december).toHaveLength(31)
  expect(december.every(issue => !issue.carryoverToId && !issue.carryoverFromId)).toBe(true)
})

it('keeps the carried copy independent when the recurring series is edited later', async () => {
  const { project } = await setup()
  const recurring = await createIssue({ projectId: project.id, title: '日課', planningMonth: '2026-11', date: '2026-11-29', startMin: 600, recurrence: { frequency: 'daily', interval: 1 } })
  const copy = await carryoverIssue(recurring.id, { date: '2026-11-30', startMin: 660, durationMin: 30 })
  const archived = await getIssue(recurring.id)
  const subsequent = (await listIssues(project.id)).find(issue => issue.recurrenceId === recurring.recurrenceId && issue.date === '2026-11-30')!
  await expect(editRecurringIssue(recurring.id, { title: '変更不可' }, 'future')).rejects.toThrow('履歴')
  await editRecurringIssue(subsequent.id, { title: '新しい日課' }, 'future')
  await prepareMonthlyProject(project.id, '2026-12', '2026-12-01')
  expect(await getIssue(recurring.id)).toEqual(archived)
  expect(await getIssue(copy.id)).toMatchObject({ title: '日課', recurrenceId: null, date: '2026-11-30', planningMonth: '2026-12' })
  const future = (await listIssues(project.id)).filter(issue => issue.date === '2026-12-01' && issue.recurrenceId)
  expect(future.map(issue => issue.title)).toEqual(['新しい日課'])
})

it('keeps all-day events and creates independent calendar links for the new attempt', async () => {
  const { source } = await setup()
  await updateIssue(source.id, { calendarAllDay: true, startMin: null })
  await db.issues.update(source.id, { calendarSource: 'google', calendarSeriesId: 'series', calendarReadOnly: true })
  const next = await carryoverIssue(source.id, { date: '2026-11-19', startMin: null, durationMin: 1440 })
  expect(next).toMatchObject({ calendarAllDay: true, startMin: null, durationMin: 1440, recurrenceId: null })
  expect(next.calendarSource).toBeUndefined()
  expect(next.calendarSeriesId).toBeUndefined()
  expect(next.calendarReadOnly).toBeUndefined()
})

it('includes relationships in backup and sync, deduplicates two offline copies and reports conflicting dates', async () => {
  const { source } = await setup()
  const base = importGuestData(await readSyncData(), initialSyncData())
  const next = await carryoverIssue(source.id, { date: '2026-11-19', startMin: 600, durationMin: 30 })
  const local = importGuestData(await readSyncData(), initialSyncData())
  const remote = structuredClone(local)
  remote.issues.find(issue => issue.id === next.id)!.date = '2026-11-20'
  expect(isSyncData(local)).toBe(true)
  const merged = mergeSyncData(base, local, remote)
  expect(merged.conflicts).toContain(source.title)
  expect(merged.data.issues.filter(issue => issue.id === next.id)).toHaveLength(1)
  expect(isSyncData(mergeSyncData(base, local, remote, 'local').data)).toBe(true)
  const broken = structuredClone(local)
  broken.issues.find(issue => issue.id === source.id)!.carryoverToId = 'missing'
  expect(isSyncData(broken)).toBe(false)
  await updateIssue(next.id, { date: null, startMin: null })
  expect(isSyncData(importGuestData(await readSyncData(), initialSyncData()))).toBe(true)
  const backup = await createBackup('system')
  expect(JSON.stringify(backup)).toContain('carryoverFromId')
})

it('rejects completed tasks, invalid schedules and backwards dates without partial copies', async () => {
  const { project, source, done } = await setup()
  for (const input of [{ date: '2026-11-18', startMin: 600, durationMin: 30 }, { date: '2026-11-19', startMin: 1430, durationMin: 30 }]) {
    await expect(carryoverIssue(source.id, input)).rejects.toThrow()
  }
  await updateIssue(source.id, { statusId: done.id })
  await expect(carryoverIssue(source.id, { date: '2026-11-19', startMin: 600, durationMin: 30 })).rejects.toThrow('完了済み')
  expect(await listIssues(project.id)).toHaveLength(1)
})
