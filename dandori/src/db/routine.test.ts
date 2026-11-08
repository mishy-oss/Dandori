import Dexie from 'dexie'
import { beforeEach, expect, it } from 'vitest'
import { db, DandoriDB } from './db'
import { createDefaultStatuses, createProject, getWorkflow } from './projectRepo'
import { createIssue, getIssue, listIssues, moveIssue, updateIssue } from './issueRepo'
import { useDataStore } from '../store/data'
import type { Workflow } from './types'

/** 保存データと画面ストアを初期化し、各テストを独立させる。 */
beforeEach(async () => {
  await Promise.all([db.projects.clear(), db.workflows.clear(), db.issues.clear(), db.recurrenceRules.clear(), db.monthlySnapshots.clear(), db.settings.clear()])
  useDataStore.setState(useDataStore.getInitialState(), true)
})

/** 定期タスクと通常タスクを比較するためにワークフローを用意する。 */
async function setup() {
  const project = await createProject({ key: 'APP', name: 'App' })
  const workflow = (await getWorkflow(project.workflowId))!
  const routine = workflow.statuses.find((s) => s.category === 'routine')!
  const doing = workflow.statuses.find((s) => s.category === 'doing')!
  const todo = workflow.statuses.find((s) => s.category === 'todo')!
  const done = workflow.statuses.find((s) => s.category === 'done')!
  return { project, workflow, routine, doing, todo, done }
}

/** 日時を指定しても、未配置に戻しても、定期タスクの列を維持する。 */
it('keeps fixed appointments in their own status without a WIP limit', async () => {
  const { project, routine } = await setup()
  expect(routine.wipLimit).toBeUndefined()
  const meeting = await createIssue({ projectId: project.id, title: '定例会議', statusId: routine.id, date: '2027-01-04', startMin: 600 })
  expect(meeting).toMatchObject({ statusId: routine.id, isRoutine: true, completedAt: null })
  expect((await updateIssue(meeting.id, { startMin: 660 })).statusId).toBe(routine.id)
  expect((await updateIssue(meeting.id, { startMin: null })).statusId).toBe(routine.id)
  expect((await updateIssue(meeting.id, { startMin: 600 })).statusId).toBe(routine.id)
})

/** 毎週の予定をまとめて生成し、完了後に生成される次回分も定期タスクとして扱う。 */
it('keeps monthly expansion and next occurrences in the routine status', async () => {
  const { project, routine, done } = await setup()
  const meeting = await createIssue({ projectId: project.id, title: '週次会議', statusId: routine.id, planningMonth: '2027-01', date: '2027-01-04', startMin: 600,
    recurrence: { frequency: 'weekly', interval: 1, weekdays: [1] } })
  const meetings = (await listIssues(project.id)).filter((issue) => issue.recurrenceId === meeting.recurrenceId)
  expect(meetings).toHaveLength(4)
  expect(meetings.every((issue) => issue.statusId === routine.id && issue.isRoutine && issue.startMin === 600)).toBe(true)
  const last = meetings.find((issue) => issue.date === '2027-01-25')!
  await updateIssue(last.id, { statusId: done.id })
  const next = (await listIssues(project.id)).find((issue) => issue.date === '2027-02-01')
  expect(next).toMatchObject({ statusId: routine.id, isRoutine: true, startMin: 600, completedAt: null })
})

/** ボードから定期タスクへ移動した場合も、完了・再開で分類を保持する。 */
it('restores routine status when a completed appointment is reopened', async () => {
  const { project, workflow, routine, done, todo } = await setup()
  const issue = await createIssue({ projectId: project.id, title: '会議', date: '2027-01-04', startMin: 600 })
  expect((await moveIssue(issue.id, routine.id, 0)).isRoutine).toBe(true)
  useDataStore.setState({ projects: [project], workflows: { [workflow.id]: workflow }, issues: (await listIssues(project.id)), currentProjectId: project.id, selectedMonth: '2027-01' })
  await useDataStore.getState().toggleIssueDone(issue.id)
  expect(await getIssue(issue.id)).toMatchObject({ statusId: done.id, isRoutine: true })
  await useDataStore.getState().toggleIssueDone(issue.id)
  expect(await getIssue(issue.id)).toMatchObject({ statusId: routine.id, isRoutine: true, completedAt: null })
  expect(await updateIssue(issue.id, { statusId: todo.id })).toMatchObject({ statusId: todo.id, isRoutine: false })
})

/** 定期タスクの子も進捗として親へ伝え、親が定期タスクなら専用列を保持する。 */
it('includes routine children in parent progress', async () => {
  const { project, routine, doing, done } = await setup()
  const parent = await createIssue({ projectId: project.id, title: '準備' })
  const child = await createIssue({ projectId: project.id, title: '打ち合わせ', parentId: parent.id, statusId: routine.id })
  expect((await getIssue(parent.id))?.statusId).toBe(doing.id)
  await updateIssue(child.id, { statusId: done.id })
  expect((await getIssue(parent.id))?.statusId).toBe(done.id)
})

/** 旧DBの列やIDを保ったまま追加し、既にある定期タスク列は重複させない。 */
it('upgrades existing workflows without replacing or duplicating statuses', async () => {
  const name = `routine-migration-${Date.now()}`
  const legacy = new Dexie(name)
  legacy.version(6).stores({ workflows: 'id, updatedAt, deletedAt' })
  const statuses = createDefaultStatuses()
  const oldStatuses = statuses.filter((s) => s.category !== 'routine')
  await legacy.table('workflows').bulkAdd([
    { id: 'old', statuses: oldStatuses, createdAt: 1, updatedAt: 1, deletedAt: null },
    { id: 'existing', statuses, createdAt: 1, updatedAt: 1, deletedAt: null },
  ])
  legacy.close()
  const upgraded = new DandoriDB(name)
  try {
    const old = (await upgraded.workflows.get('old')) as Workflow
    expect(old.statuses.filter((status) => status.category !== 'routine')).toEqual(oldStatuses)
    expect(old.statuses.filter((s) => s.category === 'routine')).toHaveLength(1)
    expect(old.statuses.find((s) => s.category === 'routine')?.name).toBe('Recurring')
    expect((await upgraded.workflows.get('existing'))?.statuses).toEqual(statuses)
  } finally {
    upgraded.close()
    await Dexie.delete(name)
  }
})

/** すでにバージョン7を利用した環境でも、IDを保って既定名だけを変更する。 */
it('renames existing routine statuses while preserving custom names and IDs', async () => {
  const name = `routine-rename-${Date.now()}`
  const legacy = new Dexie(name)
  legacy.version(7).stores({ workflows: 'id, updatedAt, deletedAt' })
  const statuses = createDefaultStatuses().map((status) => status.category === 'routine' ? { ...status, name: '定期タスク' } : status)
  const custom = statuses.map((status) => status.category === 'routine' ? { ...status, name: '会議' } : status)
  await legacy.table('workflows').bulkAdd([
    { id: 'default', statuses, createdAt: 1, updatedAt: 1, deletedAt: null },
    { id: 'custom', statuses: custom, createdAt: 1, updatedAt: 1, deletedAt: null },
  ])
  legacy.close()
  const upgraded = new DandoriDB(name)
  try {
    expect((await upgraded.workflows.get('default'))?.statuses).toEqual(statuses.map((status) => status.category === 'routine' ? { ...status, name: 'Recurring' } : status))
    expect((await upgraded.workflows.get('custom'))?.statuses).toEqual(custom)
  } finally {
    upgraded.close()
    await Dexie.delete(name)
  }
})

/** 旧順序の既存ワークフローを、タスクが参照する列のIDを変えずに並べ替える。 */
it('orders existing statuses as todo, doing, recurring and done', async () => {
  const name = `routine-order-${Date.now()}`
  const legacy = new Dexie(name)
  legacy.version(8).stores({ workflows: 'id, updatedAt, deletedAt' })
  const statuses = createDefaultStatuses()
  const oldOrder = [statuses[0], statuses[1], statuses[3], { ...statuses[2], name: 'recurring' }]
  await legacy.table('workflows').add({ id: 'old', statuses: oldOrder, createdAt: 1, updatedAt: 1, deletedAt: null })
  legacy.close()
  const upgraded = new DandoriDB(name)
  try {
    expect((await upgraded.workflows.get('old'))?.statuses).toEqual(statuses)
  } finally {
    upgraded.close()
    await Dexie.delete(name)
  }
})
