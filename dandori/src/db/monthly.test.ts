import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { createIssue, deleteIssue, listIssues, moveIssue, updateIssue } from './issueRepo'
import { createProject, getWorkflow } from './projectRepo'
import { createSprint } from './sprintRepo'
import { listMonthlySnapshots, monthlyWork, prepareMonthlyProject } from './monthlyRepo'
import { issueMonth, monthRange, shiftMonth } from '../lib/month'
import { buildMonthBurndown } from '../features/monthly/monthlyLogic'
import type { MonthlySnapshot } from './types'

beforeEach(/* 移行と月次実績の検証に使うテーブルを空にする。 */ async () => {
  await Promise.all([db.projects.clear(), db.workflows.clear(), db.issues.clear(), db.sprints.clear(), db.recurrenceRules.clear(), db.monthlySnapshots.clear(), db.settings.clear()])
})

/** テスト用のプロジェクトと完了ステータスを用意する。 */
async function setup() {
  const project = await createProject({ key: 'APP', name: 'App' })
  const workflow = (await getWorkflow(project.workflowId))!
  const done = workflow.statuses.find(/* 完了判定に使うステータスを取得する。 */ (status) => status.category === 'done')!
  return { project, workflow, done, doneIds: new Set([done.id]) }
}

describe('monthly planning', /* スプリントを使わない月次管理と既存データの移行を検証する。 */ () => {
  it('uses full calendar months and handles leap years', /* 月末と年越しが暦通りであることを確認する。 */ () => {
    expect(monthRange('2028-02')).toEqual({ startDate: '2028-02-01', endDate: '2028-02-29' })
    expect(monthRange('2027-02').endDate).toBe('2027-02-28')
    expect(shiftMonth('2027-12', 1)).toBe('2028-01')
  })

  it('migrates existing tasks without losing their old association', /* 旧スプリントを記録として残し、未完了だけ今月へ繰り越す。 */ async () => {
    const { project, done } = await setup()
    const sprint = await createSprint(project.id, { startDate: '2027-01-01', endDate: '2027-01-14' })
    const open = await createIssue({ projectId: project.id, title: '未完了', date: '2027-01-10', startMin: 540, sprintId: sprint.id })
    const completed = await createIssue({ projectId: project.id, title: '完了', date: '2027-01-11', sprintId: sprint.id, statusId: done.id })
    const future = await createIssue({ projectId: project.id, title: '未来', planningMonth: '2027-03' })
    await prepareMonthlyProject(project.id, '2027-02', '2027-02-01')
    expect(await db.issues.get(open.id)).toMatchObject({ planningMonth: '2027-02', sprintId: null, legacySprintId: sprint.id, date: '2027-01-10', startMin: 540 })
    expect(issueMonth((await db.issues.get(completed.id))!)).toBe('2027-01')
    expect(issueMonth((await db.issues.get(future.id))!)).toBe('2027-03')
    expect(await db.issues.count()).toBe(3)
    expect(await db.sprints.get(sprint.id)).toBeDefined()
    await prepareMonthlyProject(project.id, '2027-02', '2027-02-01')
    expect((await db.issues.get(open.id))?.legacySprintId).toBe(sprint.id)
  })

  it('keeps historical snapshots when unfinished work rolls over', /* 月末の残作業を記録し、翌月の繰り越し後も過去の実績を維持する。 */ async () => {
    const { project } = await setup()
    const task = await createIssue({ projectId: project.id, title: '繰り越し', planningMonth: '2027-01' })
    await prepareMonthlyProject(project.id, '2027-01', '2027-01-31')
    await prepareMonthlyProject(project.id, '2027-02', '2027-02-01')
    expect((await db.issues.get(task.id))?.planningMonth).toBe('2027-02')
    const records = await listMonthlySnapshots(project.id)
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({ month: '2027-01', date: '2027-01-31', totalCount: 1, remainingCount: 1 })
    expect(records[1]).toMatchObject({ month: '2027-02', totalCount: 1, remainingCount: 1 })
  })

  it('records each day once and counts leaf work without double-counting parents', /* 親と子の二重計上を防ぎ、同じ日の再記録は上書きする。 */ async () => {
    const { project, done, doneIds } = await setup()
    const parent = await createIssue({ projectId: project.id, title: '親', planningMonth: '2027-01' })
    const child = await createIssue({ projectId: project.id, title: '子', parentId: parent.id, planningMonth: '2027-01' })
    await createIssue({ projectId: project.id, title: 'Epic', type: 'epic', planningMonth: '2027-01' })
    await prepareMonthlyProject(project.id, '2027-01', '2027-01-12')
    expect(monthlyWork(await listIssues(project.id), '2027-01', doneIds)).toEqual({ totalCount: 1, remainingCount: 1 })
    await updateIssue(child.id, { statusId: done.id })
    await prepareMonthlyProject(project.id, '2027-01', '2027-01-12')
    expect(await listMonthlySnapshots(project.id)).toHaveLength(1)
    expect((await listMonthlySnapshots(project.id))[0]).toMatchObject({ totalCount: 1, remainingCount: 0 })
  })

  it('generates daily occurrences for the selected month without creating a sprint', /* 今月と選択月の予定を重複なく生成する。 */ async () => {
    const { project } = await setup()
    await createIssue({ projectId: project.id, title: '毎日', date: '2027-01-01', planningMonth: '2027-01', recurrence: { frequency: 'daily', interval: 1 } })
    expect(await db.sprints.count()).toBe(0)
    expect(await db.issues.count()).toBe(31)
    await prepareMonthlyProject(project.id, '2027-02', '2027-01-01')
    expect((await listIssues(project.id)).filter(/* 2月分だけを数える。 */ (issue) => issueMonth(issue) === '2027-02')).toHaveLength(28)
    await prepareMonthlyProject(project.id, '2027-02', '2027-01-01')
    expect(await db.issues.count()).toBe(59)
  })

  it('does not resurrect an occurrence deleted from a month', /* 削除した回が月の再表示で再作成されないことを確認する。 */ async () => {
    const { project } = await setup()
    const first = await createIssue({ projectId: project.id, title: '毎日', date: '2027-01-01', planningMonth: '2027-01', recurrence: { frequency: 'daily', interval: 1 } })
    await deleteIssue(first.id)
    await prepareMonthlyProject(project.id, '2027-01', '2027-01-01')
    const occurrences = await db.issues.where('recurrenceId').equals(first.recurrenceId!).toArray()
    expect(occurrences.filter(/* 削除した日の回数を確認する。 */ (issue) => issue.date === '2027-01-01')).toHaveLength(1)
    expect((await listIssues(project.id)).some(/* 削除済みの回は一覧に出さない。 */ (issue) => issue.id === first.id)).toBe(false)
  })

  it('reorders within the selected month without moving tasks of other months', /* 月の範囲で位置を解釈し、別月のタスクを並べ替え対象にしない。 */ async () => {
    const { project, workflow } = await setup()
    await createIssue({ projectId: project.id, title: '別月', planningMonth: '2027-02' })
    await createIssue({ projectId: project.id, title: '先頭', planningMonth: '2027-01' })
    const last = await createIssue({ projectId: project.id, title: '末尾', planningMonth: '2027-01' })
    await moveIssue(last.id, workflow.statuses[0].id, 0, undefined, '2027-01')
    expect((await listIssues(project.id)).filter(/* 対象月の順番だけを比較する。 */ (issue) => issueMonth(issue) === '2027-01').map(/* タイトルで順番を確認する。 */ (issue) => issue.title)).toEqual(['末尾', '先頭'])
  })
})

/** グラフに渡す日次実績を作る。 */
function snapshot(date: string, remainingCount: number, totalCount = 3): MonthlySnapshot {
  return { id: date, projectId: 'project', month: date.slice(0, 7), date, totalCount, remainingCount }
}

describe('monthly burndown history', /* 実際に観測した期間だけを実績線に使うことを検証する。 */ () => {
  it('does not invent data before the first record or in the future', /* 記録開始前と未来を空白にし、記録間だけ前値を維持する。 */ () => {
    const result = buildMonthBurndown('2027-01', [snapshot('2027-01-10', 3), snapshot('2027-01-12', 1)], { totalCount: 3, remainingCount: 1 }, '2027-01-12')
    expect(result.points).toHaveLength(31)
    expect(result.points[8].actual).toBeNull()
    expect(result.points[9].actual).toBe(3)
    expect(result.points[10].actual).toBe(3)
    expect(result.points[11].actual).toBe(1)
    expect(result.points[12].actual).toBeNull()
    expect(result.points.at(-1)?.ideal).toBe(0)
  })

  it('uses saved history after all unfinished tasks have moved to another month', /* 現在のタスク一覧に過去月の未完了がなくても、過去の実績を保持する。 */ () => {
    const result = buildMonthBurndown('2027-01', [snapshot('2027-01-31', 2)], { totalCount: 0, remainingCount: 0 }, '2027-02-01')
    expect(result.remaining).toBe(2)
    expect(result.total).toBe(3)
    expect(result.points.at(-1)?.actual).toBe(2)
  })
})
