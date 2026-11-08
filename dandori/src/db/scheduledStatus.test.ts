import { beforeEach, expect, it } from 'vitest'
import { db } from './db'
import { createIssue, getIssue, updateIssue } from './issueRepo'
import { createProject, getWorkflow } from './projectRepo'

/** 各テストの前にプロジェクトとタスクを初期化する。 */
beforeEach(async () => {
  await Promise.all([db.projects.clear(), db.workflows.clear(), db.issues.clear()])
})

/** ワークフローの実際のIDを使い、自動変更先を確認する。 */
async function setup() {
  const project = await createProject({ key: 'APP', name: 'App' })
  const workflow = (await getWorkflow(project.workflowId))!
  const todo = workflow.statuses.find((s) => s.category === 'todo')!
  const doing = workflow.statuses.find((s) => s.category === 'doing')!
  const done = workflow.statuses.find((s) => s.category === 'done')!
  return { projectId: project.id, workflow, todo, doing, done }
}

/** 日付だけでは未着手を保ち、開始時刻を追加したら進行中で永続化する。 */
it('starts a task when it is placed on the schedule', async () => {
  const { projectId, todo, doing } = await setup()
  const issue = await createIssue({ projectId, title: 'Task' })
  expect((await updateIssue(issue.id, { date: '2026-11-08' })).statusId).toBe(todo.id)
  const placed = await updateIssue(issue.id, { date: '2026-11-08', startMin: 0 })
  expect(placed).toMatchObject({ statusId: doing.id, completedAt: null })
  expect((await getIssue(issue.id))?.statusId).toBe(doing.id)
})

/** 編集画面で日時を指定して新規作成する場合も進行中にする。 */
it('creates a scheduled task in progress', async () => {
  const { projectId, todo, doing } = await setup()
  const issue = await createIssue({ projectId, title: 'Task', statusId: todo.id, date: '2026-11-08', startMin: 600 })
  expect(issue).toMatchObject({ statusId: doing.id, completedAt: null })
})

/** 配置後の時刻変更では、手動で選んだステータスを保つ。 */
it('keeps manual statuses when moving an existing schedule', async () => {
  const { projectId, todo } = await setup()
  const issue = await createIssue({ projectId, title: 'Task', date: '2026-11-08', startMin: 600 })
  await updateIssue(issue.id, { statusId: todo.id })
  expect((await updateIssue(issue.id, { startMin: 660, durationMin: 45 })).statusId).toBe(todo.id)
  expect((await updateIssue(issue.id, { date: null, startMin: null })).statusId).toBe(todo.id)
})

/** 時刻だけを消す操作と日時を両方消す操作のどちらでも未着手に戻す。 */
it('returns an in-progress task to todo when it becomes unplaced', async () => {
  const { projectId, todo, doing } = await setup()
  for (const patch of [{ startMin: null }, { date: null, startMin: null }]) {
    const issue = await createIssue({ projectId, title: 'Task', date: '2026-11-08', startMin: 600 })
    expect(issue.statusId).toBe(doing.id)
    const cleared = await updateIssue(issue.id, patch)
    expect(cleared).toMatchObject({ statusId: todo.id, completedAt: null, startMin: null })
    expect((await getIssue(issue.id))?.statusId).toBe(todo.id)
    expect((await updateIssue(issue.id, { date: '2026-11-08', startMin: 600 })).statusId).toBe(doing.id)
  }
})

/** 完了済みの予定は未配置に戻しても完了状態を保つ。 */
it('keeps completed tasks completed when clearing the schedule', async () => {
  const { projectId, done } = await setup()
  const issue = await createIssue({ projectId, title: 'Done', statusId: done.id, date: '2026-11-08', startMin: 600 })
  expect(await updateIssue(issue.id, { date: null, startMin: null }))
    .toMatchObject({ statusId: done.id, completedAt: issue.completedAt })
})

/** 完了済みのタスクを配置しても完了日時と完了状態を保つ。 */
it('keeps completed tasks completed on placement and creation', async () => {
  const { projectId, done } = await setup()
  const issue = await createIssue({ projectId, title: 'Done', statusId: done.id })
  expect(await updateIssue(issue.id, { date: '2026-11-08', startMin: 600 }))
    .toMatchObject({ statusId: done.id, completedAt: issue.completedAt })
  const scheduled = await createIssue({ projectId, title: 'Done', statusId: done.id, date: '2026-11-08', startMin: 600 })
  expect(scheduled.statusId).toBe(done.id)
  expect(scheduled.completedAt).not.toBeNull()
})

/** 進行中の列がないワークフローでも、予定の追加は成功させる。 */
it('keeps the status when the workflow has no doing category', async () => {
  const { projectId, workflow, todo } = await setup()
  await db.workflows.update(workflow.id, { statuses: workflow.statuses.filter((s) => s.category !== 'doing') })
  const issue = await createIssue({ projectId, title: 'Task' })
  expect((await updateIssue(issue.id, { date: '2026-11-08', startMin: 600 })).statusId).toBe(todo.id)
})
