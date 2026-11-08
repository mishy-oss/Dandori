import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { createIssue, listIssues, updateIssue } from './issueRepo'
import { createProject, getWorkflow } from './projectRepo'
import { createSprint } from './sprintRepo'

beforeEach(/* 他のテストのデータが繰り返し生成へ影響しないよう、使用するテーブルを空にする。 */ async () => {
  await Promise.all([db.projects.clear(), db.workflows.clear(), db.issues.clear(), db.sprints.clear(), db.recurrenceRules.clear()])
})

describe('monthly recurrence', /* 毎月設定の保存と、実際のIssue生成をまとめて検証する。 */ () => {
  it('can create and edit a monthly rule', /* 作成時と編集時の両方で毎月設定と月数間隔を保存できることを確認する。 */ async () => {
    const project = await createProject({ key: 'APP', name: 'App' })
    const issue = await createIssue({ projectId: project.id, title: '月次確認', date: '2027-01-15', recurrence: { frequency: 'monthly', interval: 1 } })
    expect(await db.recurrenceRules.get(issue.recurrenceId!)).toMatchObject({ frequency: 'monthly', interval: 1, startDate: '2027-01-15' })
    const edited = await updateIssue(issue.id, { recurrence: { frequency: 'monthly', interval: 2 } })
    expect(await db.recurrenceRules.get(edited.recurrenceId!)).toMatchObject({ frequency: 'monthly', interval: 2 })
  })

  it('generates successive months on completion and restores day 31', /* 完了のたびに次回分を作り、2月の翌月には31日へ戻ることを確認する。 */ async () => {
    const project = await createProject({ key: 'APP', name: 'App' })
    const workflow = (await getWorkflow(project.workflowId))!
    const done = workflow.statuses.find(/* 完了への遷移に使うステータスを取得する。 */ (status) => status.category === 'done')!
    const first = await createIssue({ projectId: project.id, title: '月末確認', date: '2027-01-31', startMin: 540, reminderOffsetMin: 15, recurrence: { frequency: 'monthly', interval: 1 } })
    await updateIssue(first.id, { statusId: done.id })
    const february = (await listIssues(project.id)).find(/* 生成された2月分を取得する。 */ (issue) => issue.date === '2027-02-28')!
    expect(february).toMatchObject({ startMin: 540, reminderOffsetMin: 15, completedAt: null, sprintId: null })
    await updateIssue(february.id, { statusId: done.id })
    const dates = (await listIssues(project.id)).map(/* 生成された日付だけを比較する。 */ (issue) => issue.date)
    expect(dates.sort()).toEqual(['2027-01-31', '2027-02-28', '2027-03-31'])
  })

  it('expands monthly tasks within the sprint and honors the end date', /* スプリント期間内でも月末補正を使い、繰り返し終了日を超える予定を作らないことを確認する。 */ async () => {
    const project = await createProject({ key: 'APP', name: 'App' })
    const sprint = await createSprint(project.id, { startDate: '2027-01-31', endDate: '2027-05-31' })
    await createIssue({ projectId: project.id, title: '月次報告', date: '2027-01-31', sprintId: sprint.id, recurrence: { frequency: 'monthly', interval: 1, endDate: '2027-04-30' } })
    expect((await listIssues(project.id)).map(/* スプリント内で生成された日付を確認する。 */ (issue) => issue.date)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'])
  })

  it('respects multi-month intervals inside the sprint', /* 2か月ごとの設定が、スプリント内でも毎月に変わらないことを確認する。 */ async () => {
    const project = await createProject({ key: 'APP', name: 'App' })
    const sprint = await createSprint(project.id, { startDate: '2027-01-31', endDate: '2027-05-31' })
    await createIssue({ projectId: project.id, title: '隔月確認', date: '2027-01-31', sprintId: sprint.id, recurrence: { frequency: 'monthly', interval: 2 } })
    expect((await listIssues(project.id)).map(/* 間隔に合う月だけ生成されているかを確認する。 */ (issue) => issue.date)).toEqual(['2027-01-31', '2027-03-31', '2027-05-31'])
  })
})
