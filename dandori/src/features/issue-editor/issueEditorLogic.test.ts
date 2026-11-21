import { beforeEach, expect, it } from 'vitest'
import { db } from '../../db/db'
import { createIssue, getIssue, updateIssue } from '../../db/issueRepo'
import { createProject, getWorkflow } from '../../db/projectRepo'
import { appendIssueLabel, scheduledEditorStatusId } from './issueEditorLogic'
import { matchesFilter, EMPTY_FILTER } from '../backlog/filters'

beforeEach(async () => {
  await Promise.all([db.projects.clear(), db.workflows.clear(), db.issues.clear(), db.recurrenceRules.clear()])
})

it('persists labels from editor input and makes them searchable', async () => {
  const project = await createProject({ key: 'APP', name: 'App' })
  const labels = appendIssueLabel(['顧客,相談'], '  買い物  ')
  expect(labels).toEqual(['顧客,相談', '買い物'])
  expect(appendIssueLabel(labels, '買い物')).toEqual(labels)
  expect(appendIssueLabel(labels, '  ')).toEqual(labels)
  const issue = await createIssue({ projectId: project.id, title: '準備', labels })
  expect(matchesFilter(issue, { ...EMPTY_FILTER, query: '買い物' })).toBe(true)
  const updated = await updateIssue(issue.id, { labels: appendIssueLabel(issue.labels.filter((label) => label !== '買い物'), '仕事') })
  expect((await getIssue(issue.id))?.labels).toEqual(['顧客,相談', '仕事'])
  expect(matchesFilter(updated, { ...EMPTY_FILTER, query: '買い物' })).toBe(false)
  expect(matchesFilter(updated, { ...EMPTY_FILTER, query: '仕事' })).toBe(true)
})

it('reuses existing labels for creation, updates and saving an unconfirmed label draft', async () => {
  const project = await createProject({ key: 'APP', name: 'App' })
  const first = await createIssue({ projectId: project.id, title: '元のタスク', labels: ['API', '仕事'] })
  const draft = appendIssueLabel(['仕事'], '  ａｐｉ  ', first.labels)
  expect(draft).toEqual(['仕事', 'API'])
  const second = await createIssue({ projectId: project.id, title: '新しいタスク', labels: ['api', 'ＡＰＩ', ' 仕事 ', 'Web　 会議', ''] })
  expect(second.labels).toEqual(['API', '仕事', 'Web 会議'])
  const updated = await updateIssue(second.id, { labels: ['Ａｐｉ', 'api', '新規'] })
  expect(updated.labels).toEqual(['API', '新規'])
  expect((await getIssue(first.id))?.labels).toEqual(['API', '仕事'])
  expect(appendIssueLabel(updated.labels, ' api ', first.labels)).toEqual(updated.labels)
})

it('does not rewrite legacy labels on unrelated updates and searches their variants consistently', async () => {
  const project = await createProject({ key: 'APP', name: 'App' })
  const issue = await createIssue({ projectId: project.id, title: '旧データ' })
  await db.issues.update(issue.id, { labels: ['  ＡＰＩ　連携  '] })
  const saved = await updateIssue(issue.id, { title: 'タイトルだけ変更' })
  expect(saved.labels).toEqual(['  ＡＰＩ　連携  '])
  expect(matchesFilter(saved, { ...EMPTY_FILTER, query: 'api  連携' })).toBe(true)
})

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

it('keeps the task in progress when the form submits after another placement', async () => {
  const project = await createProject({ key: 'APP', name: 'App' })
  const { statuses } = (await getWorkflow(project.workflowId))!
  const issue = await createIssue({ projectId: project.id, title: 'Task' })
  await updateIssue(issue.id, { date: '2026-11-12', startMin: 600 })
  const statusId = scheduledEditorStatusId(statuses, issue.statusId, '2026-11-12', 600, true)
  const saved = await updateIssue(issue.id, { statusId, date: '2026-11-12', startMin: 600 })
  expect(statuses.find((status) => status.id === saved.statusId)?.category).toBe('doing')
})

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

it('preserves recurring and done statuses on schedule changes', async () => {
  const project = await createProject({ key: 'APP', name: 'App' })
  const { statuses } = (await getWorkflow(project.workflowId))!
  for (const status of statuses.filter((item) => item.category === 'routine' || item.category === 'done')) {
    expect(scheduledEditorStatusId(statuses, status.id, '2026-11-12', 600, true)).toBe(status.id)
  }
})
