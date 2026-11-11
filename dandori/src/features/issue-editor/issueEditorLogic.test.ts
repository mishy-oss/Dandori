import { beforeEach, expect, it } from 'vitest'
import { db } from '../../db/db'
import { createIssue, getIssue, updateIssue } from '../../db/issueRepo'
import { createProject, getWorkflow } from '../../db/projectRepo'
import { scheduledEditorStatusId } from './issueEditorLogic'

/** フォーム保存を検証するため、関連データを初期化する。 */
beforeEach(async () => {
  await Promise.all([db.projects.clear(), db.workflows.clear(), db.issues.clear(), db.recurrenceRules.clear()])
})

/** 既に日時があるTo Doタスクでも、フォームで時刻を変更したら進行中で保存する。 */
it('starts an already placed todo task when the form changes its time', async () => {
  const project = await createProject({ key: 'APP', name: 'App' })
  const { statuses } = (await getWorkflow(project.workflowId))!
  const todo = statuses.find((status) => status.category === 'todo')!
  const doing = statuses.find((status) => status.category === 'doing')!
  const issue = await createIssue({ projectId: project.id, title: 'Task', date: '2026-11-12', startMin: 600 })
  await updateIssue(issue.id, { statusId: todo.id })
  await updateIssue(issue.id, {
    title: issue.title, planningMonth: '2026-11', recurrence: null,
    date: '2026-11-12', startMin: 660,
    statusId: scheduledEditorStatusId(statuses, todo.id, '2026-11-12', 660, true),
  })
  expect(await getIssue(issue.id)).toMatchObject({ statusId: doing.id, startMin: 660, completedAt: null })
})

/** フォームを開いている間にDBの配置が変わっていても、古いTo Doで進行中を上書きしない。 */
it('keeps the task in progress when the form submits after another placement', async () => {
  const project = await createProject({ key: 'APP', name: 'App' })
  const { statuses } = (await getWorkflow(project.workflowId))!
  const issue = await createIssue({ projectId: project.id, title: 'Task' })
  await updateIssue(issue.id, { date: '2026-11-12', startMin: 600 })
  const statusId = scheduledEditorStatusId(statuses, issue.statusId, '2026-11-12', 600, true)
  const saved = await updateIssue(issue.id, { statusId, date: '2026-11-12', startMin: 600 })
  expect(statuses.find((status) => status.id === saved.statusId)?.category).toBe('doing')
})

/** 新規作成と0時の配置にも対応し、日付だけの指定や日時以外の編集では状態を維持する。 */
it('starts scheduled creation but preserves unscheduled and unchanged forms', async () => {
  const project = await createProject({ key: 'APP', name: 'App' })
  const { statuses } = (await getWorkflow(project.workflowId))!
  const todo = statuses.find((status) => status.category === 'todo')!
  const doing = statuses.find((status) => status.category === 'doing')!
  expect(scheduledEditorStatusId(statuses, todo.id, '2026-11-12', 0, true)).toBe(doing.id)
  expect(scheduledEditorStatusId(statuses, todo.id, '2026-11-12', null, true)).toBe(todo.id)
  expect(scheduledEditorStatusId(statuses, todo.id, null, null, true)).toBe(todo.id)
  expect(scheduledEditorStatusId(statuses, todo.id, '2026-11-12', 600, false)).toBe(todo.id)
  expect(scheduledEditorStatusId(statuses.filter((status) => status.category !== 'doing'), todo.id, '2026-11-12', 600, true)).toBe(todo.id)
})

/** 会議用のRecurringと完了済みのDoneを、時刻入力で通常の進行中に変えない。 */
it('preserves recurring and done statuses on schedule changes', async () => {
  const project = await createProject({ key: 'APP', name: 'App' })
  const { statuses } = (await getWorkflow(project.workflowId))!
  for (const status of statuses.filter((item) => item.category === 'routine' || item.category === 'done')) {
    expect(scheduledEditorStatusId(statuses, status.id, '2026-11-12', 600, true)).toBe(status.id)
  }
})
