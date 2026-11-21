import { beforeEach, expect, it } from 'vitest'
import { db } from './db'
import { createIssue, getIssue, listIssues, updateIssue, deleteIssue } from './issueRepo'
import { createProject, getWorkflow } from './projectRepo'
import { editRecurringIssue } from './recurringEditRepo'
import { prepareMonthlyProject } from './monthlyRepo'
import { carryoverIssue } from './carryoverRepo'
import { groupBoardIssues } from '../features/board/recurringGroups'
import { readSyncData, saveLocalImport } from '../features/account/accountRepo'
import { importGuestData, initialSyncData, isSyncData, mergeSyncData } from '../features/account/syncModel'

beforeEach(async () => { await Promise.all(db.tables.map(table => table.clear())) })
async function setup() {
  const project = await createProject({ key: 'APP', name: 'App' })
  const workflow = (await getWorkflow(project.workflowId))!
  const done = workflow.statuses.find(status => status.category === 'done')!
  const first = await createIssue({ projectId: project.id, title: '元の作業', date: '2027-01-01', planningMonth: '2027-01', startMin: 540, durationMin: 30,
    labels: ['元'], recurrence: { frequency: 'daily', interval: 1 } })
  return { project, first, done }
}
async function occurrence(projectId: string, date: string) { return (await listIssues(projectId)).find(issue => issue.date === date)! }

it('uses canonical labels in future occurrences and the generation template', async () => {
  const { project } = await setup()
  await createIssue({ projectId: project.id, title: '既存ラベル', labels: ['API'] })
  const target = await occurrence(project.id, '2027-01-10')
  const saved = await editRecurringIssue(target.id, { labels: [' ａｐｉ ', 'ＡＰＩ'] }, 'future')
  expect(saved.labels).toEqual(['API'])
  expect((await db.recurrenceRules.get(saved.recurrenceId!))?.template?.labels).toEqual(['API'])
  expect((await occurrence(project.id, '2027-01-11')).labels).toEqual(['API'])
  await prepareMonthlyProject(project.id, '2027-02', '2027-01-10')
  expect((await occurrence(project.id, '2027-02-01')).labels).toEqual(['API'])
})

it('keeps a single exception out of existing and newly generated occurrences', async () => {
  const { project } = await setup()
  const target = await occurrence(project.id, '2027-01-10')
  const originalRule = await db.recurrenceRules.get(target.recurrenceId!)
  await editRecurringIssue(target.id, { title: 'この日だけ', startMin: 600, durationMin: 45, planningMonth: '2027-01' }, 'single')
  expect(await getIssue(target.id)).toMatchObject({ title: 'この日だけ', startMin: 600, durationMin: 45 })
  expect(await occurrence(project.id, '2027-01-11')).toMatchObject({ title: '元の作業', startMin: 540, durationMin: 30 })
  expect((await db.recurrenceRules.get(target.recurrenceId!))?.startDate).toBe(originalRule?.startDate)
  await prepareMonthlyProject(project.id, '2027-02', '2027-01-10')
  expect(await occurrence(project.id, '2027-02-01')).toMatchObject({ title: '元の作業', startMin: 540, durationMin: 30 })
})

it('does not regenerate the original date after moving or unplacing one occurrence', async () => {
  const { project } = await setup()
  const target = await occurrence(project.id, '2027-01-10')
  await editRecurringIssue(target.id, { date: '2027-02-10' }, 'single')
  await prepareMonthlyProject(project.id, '2027-01', '2027-01-10')
  expect((await listIssues(project.id)).filter(issue => issue.recurrenceDate === '2027-01-10')).toHaveLength(1)
  expect((await getIssue(target.id))?.date).toBe('2027-02-10')
  await editRecurringIssue(target.id, { date: null, startMin: null }, 'single')
  await prepareMonthlyProject(project.id, '2027-01', '2027-01-10')
  expect((await getIssue(target.id))?.date).toBeNull()
})

it('changes only edited fields in subsequent unfinished work and uses the new template next month', async () => {
  const { project, first, done } = await setup()
  const target = await occurrence(project.id, '2027-01-10')
  const completed = await occurrence(project.id, '2027-01-12')
  await updateIssue(completed.id, { statusId: done.id })
  const archived = await occurrence(project.id, '2027-01-13')
  await carryoverIssue(archived.id, { date: '2027-01-14', startMin: 660, durationMin: 30 })
  const exception = await occurrence(project.id, '2027-01-11')
  await editRecurringIssue(exception.id, { startMin: 720 }, 'single')
  const saved = await editRecurringIssue(target.id, { title: '今後の作業', labels: ['変更'], recurrence: { frequency: 'daily', interval: 1 } }, 'future')
  expect(saved.recurrenceId).not.toBe(first.recurrenceId)
  expect(await occurrence(project.id, '2027-01-09')).toMatchObject({ title: '元の作業' })
  expect(await getIssue(exception.id)).toMatchObject({ title: '今後の作業', startMin: 720, labels: ['変更'] })
  expect(await getIssue(completed.id)).toMatchObject({ title: '元の作業', statusId: done.id })
  expect(await getIssue(archived.id)).toMatchObject({ title: '元の作業', carryoverToId: expect.any(String) })
  await prepareMonthlyProject(project.id, '2027-02', '2027-01-10')
  expect(await occurrence(project.id, '2027-02-01')).toMatchObject({ title: '今後の作業', startMin: 540, labels: ['変更'] })
  const sameDate = (await listIssues(project.id)).filter(issue => issue.date === '2027-01-12')
  expect(sameDate).toHaveLength(1)
  expect(groupBoardIssues((await listIssues(project.id)).filter(issue => issue.planningMonth === '2027-01' && issue.recurrenceId), new Set([done.id]))).toHaveLength(1)
})

it('rebuilds future weekdays without resurrecting removed dates and keeps earlier history intact', async () => {
  const { project } = await setup()
  const target = await occurrence(project.id, '2027-01-10')
  const saved = await editRecurringIssue(target.id, { recurrence: { frequency: 'weekly', interval: 1, weekdays: [1, 3] } }, 'future')
  expect(saved.date).toBe('2027-01-11')
  const future = (await listIssues(project.id)).filter(issue => issue.recurrenceId === saved.recurrenceId)
  expect(future.map(issue => issue.date).sort()).toEqual(['2027-01-11', '2027-01-13', '2027-01-18', '2027-01-20', '2027-01-25', '2027-01-27'])
  expect(await occurrence(project.id, '2027-01-09')).toBeDefined()
  await prepareMonthlyProject(project.id, '2027-01', '2027-01-10')
  expect((await listIssues(project.id)).filter(issue => issue.recurrenceId === saved.recurrenceId)).toHaveLength(6)
})

it('stops this and future work while keeping protected records and tasks with children', async () => {
  const { project, done } = await setup()
  const target = await occurrence(project.id, '2027-01-10')
  const protectedIssue = await occurrence(project.id, '2027-01-11')
  const parent = await occurrence(project.id, '2027-01-12')
  const child = await createIssue({ projectId: project.id, title: '子の作業', parentId: parent.id })
  await updateIssue(protectedIssue.id, { statusId: done.id })
  await editRecurringIssue(target.id, { recurrence: null }, 'future')
  expect((await getIssue(target.id))?.recurrenceId).toBeNull()
  expect(await getIssue(protectedIssue.id)).toBeDefined()
  expect(await getIssue(parent.id)).toMatchObject({ recurrenceId: null })
  expect((await getIssue(child.id))?.parentId).toBe(parent.id)
  expect(await occurrence(project.id, '2027-01-13')).toBeUndefined()
  await prepareMonthlyProject(project.id, '2027-02', '2027-01-10')
  expect(await occurrence(project.id, '2027-02-01')).toBeUndefined()
})

it('keeps the original monthly anchor through February and supports repeated splits', async () => {
  const project = await createProject({ key: 'APP', name: 'App' })
  const first = await createIssue({ projectId: project.id, title: '月末', date: '2027-01-31', planningMonth: '2027-01', recurrence: { frequency: 'monthly', interval: 1 } })
  await prepareMonthlyProject(project.id, '2027-02', '2027-01-01')
  const feb = await occurrence(project.id, '2027-02-28')
  const split = await editRecurringIssue(feb.id, { title: '月末更新' }, 'future')
  expect((await db.recurrenceRules.get(split.recurrenceId!))?.startDate).toBe('2027-01-31')
  await prepareMonthlyProject(project.id, '2027-03', '2027-01-01')
  const march = await occurrence(project.id, '2027-03-31')
  await editRecurringIssue(march.id, { startMin: 600 }, 'future')
  await prepareMonthlyProject(project.id, '2027-04', '2027-01-01')
  expect(await occurrence(project.id, '2027-04-30')).toMatchObject({ title: '月末更新', startMin: 600, recurrenceSeriesId: first.recurrenceId })
})

it('rolls back the entire series edit on invalid future schedules', async () => {
  const { project } = await setup()
  const target = await occurrence(project.id, '2027-01-10')
  const late = await occurrence(project.id, '2027-01-11')
  await editRecurringIssue(late.id, { startMin: 1410 }, 'single')
  const before = await readSyncData()
  await expect(editRecurringIssue(target.id, { durationMin: 60 }, 'future')).rejects.toThrow('24:00')
  expect(await readSyncData()).toEqual(before)
})

it('retains deleted exceptions and round trips the new rule metadata through sync', async () => {
  const { project } = await setup()
  const deleted = await occurrence(project.id, '2027-01-15')
  await deleteIssue(deleted.id)
  await editRecurringIssue((await occurrence(project.id, '2027-01-10')).id, { title: '新しい基本設定' }, 'future')
  await prepareMonthlyProject(project.id, '2027-01', '2027-01-10')
  expect(await occurrence(project.id, '2027-01-15')).toBeUndefined()
  const sync = importGuestData(await readSyncData(), initialSyncData())
  expect(isSyncData(sync)).toBe(true)
  sync.recurrenceRules.find(rule => rule.template)!.template!.durationMin = -1
  expect(isSyncData(sync)).toBe(false)
})

it('keeps completion local even when future scope is chosen and never propagates one-off values on completion', async () => {
  const project = await createProject({ key: 'APP', name: 'App' })
  const workflow = (await getWorkflow(project.workflowId))!
  const done = workflow.statuses.find(status => status.category === 'done')!
  const first = await createIssue({ projectId: project.id, title: '基本', date: '2027-01-31', recurrence: { frequency: 'monthly', interval: 1 } })
  await editRecurringIssue(first.id, { title: '例外', statusId: done.id }, 'single')
  const feb = await occurrence(project.id, '2027-02-28')
  expect(feb.title).toBe('基本')
  await editRecurringIssue(feb.id, { title: '  今後  ', statusId: done.id }, 'future')
  const march = await occurrence(project.id, '2027-03-31')
  expect(march.title).toBe('今後')
  expect(march.statusId).not.toBe(done.id)
})

it('applies all-day and minute-precision schedules without changing completed future records', async () => {
  const { project } = await setup()
  const target = await occurrence(project.id, '2027-01-10')
  await editRecurringIssue(target.id, { calendarAllDay: true, startMin: null, durationMin: 1440 }, 'future')
  expect(await occurrence(project.id, '2027-01-11')).toMatchObject({ calendarAllDay: true, durationMin: 1440, startMin: null })
  const again = await occurrence(project.id, '2027-01-11')
  await editRecurringIssue(again.id, { calendarAllDay: false, startMin: 1000, durationMin: 37 }, 'future')
  expect(await occurrence(project.id, '2027-01-12')).toMatchObject({ calendarAllDay: false, startMin: 1000, durationMin: 37 })
})

it('reconciles two offline series edits to the chosen weekdays without retaining duplicate generated work', async () => {
  const { project } = await setup()
  const target = await occurrence(project.id, '2027-01-10')
  const original = await readSyncData()
  const base = importGuestData(original, initialSyncData(0))
  await editRecurringIssue(target.id, { recurrence: { frequency: 'weekly', interval: 1, weekdays: [1] } }, 'future')
  const local = importGuestData(await readSyncData(), initialSyncData(0))
  await saveLocalImport(original)
  await editRecurringIssue(target.id, { recurrence: { frequency: 'weekly', interval: 1, weekdays: [3] } }, 'future')
  const remote = importGuestData(await readSyncData(), initialSyncData(0))
  const merged = mergeSyncData(base, local, remote, 'local')
  expect(merged.conflicts.length).toBeGreaterThan(0)
  await saveLocalImport(merged.data)
  await prepareMonthlyProject('account-project', '2027-01', '2027-01-10')
  const series = (await listIssues('account-project')).filter(issue => (issue.recurrenceDate ?? '') >= '2027-01-10')
  expect(series.map(issue => issue.date).sort()).toEqual(['2027-01-11', '2027-01-18', '2027-01-25'])
  expect(isSyncData(await readSyncData())).toBe(true)
})
