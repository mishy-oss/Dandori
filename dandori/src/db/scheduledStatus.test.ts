import { beforeEach, expect, it } from 'vitest'
import { db } from './db'
import { createIssue, getIssue, updateIssue } from './issueRepo'
import { createProject, getWorkflow } from './projectRepo'

beforeEach(async () => {
  await Promise.all([db.projects.clear(), db.workflows.clear(), db.issues.clear()])
})

async function setup() {
  const project = await createProject({ key: 'APP', name: 'App' })
  const workflow = (await getWorkflow(project.workflowId))!
  const todo = workflow.statuses.find((s) => s.category === 'todo')!
  const doing = workflow.statuses.find((s) => s.category === 'doing')!
  const done = workflow.statuses.find((s) => s.category === 'done')!
  return { projectId: project.id, workflow, todo, doing, done }
}

it('starts a task when it is placed on the schedule', async () => {
  const { projectId, todo, doing } = await setup()
  const issue = await createIssue({ projectId, title: 'Task' })
  expect((await updateIssue(issue.id, { date: '2026-11-08' })).statusId).toBe(todo.id)
  const placed = await updateIssue(issue.id, { date: '2026-11-08', startMin: 0 })
  expect(placed).toMatchObject({ statusId: doing.id, completedAt: null })
  expect((await getIssue(issue.id))?.statusId).toBe(doing.id)
})

it('creates a scheduled task in progress', async () => {
  const { projectId, todo, doing } = await setup()
  const issue = await createIssue({ projectId, title: 'Task', statusId: todo.id, date: '2026-11-08', startMin: 600 })
  expect(issue).toMatchObject({ statusId: doing.id, completedAt: null })
})

it('keeps manual statuses when moving an existing schedule', async () => {
  const { projectId, todo } = await setup()
  const issue = await createIssue({ projectId, title: 'Task', date: '2026-11-08', startMin: 600 })
  await updateIssue(issue.id, { statusId: todo.id })
  expect((await updateIssue(issue.id, { startMin: 660, durationMin: 45 })).statusId).toBe(todo.id)
  expect((await updateIssue(issue.id, { date: null, startMin: null })).statusId).toBe(todo.id)
})

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

it('keeps completed tasks completed when clearing the schedule', async () => {
  const { projectId, done } = await setup()
  const issue = await createIssue({ projectId, title: 'Done', statusId: done.id, date: '2026-11-08', startMin: 600 })
  expect(await updateIssue(issue.id, { date: null, startMin: null }))
    .toMatchObject({ statusId: done.id, completedAt: issue.completedAt })
})

it('keeps completed tasks completed on placement and creation', async () => {
  const { projectId, done } = await setup()
  const issue = await createIssue({ projectId, title: 'Done', statusId: done.id })
  expect(await updateIssue(issue.id, { date: '2026-11-08', startMin: 600 }))
    .toMatchObject({ statusId: done.id, completedAt: issue.completedAt })
  const scheduled = await createIssue({ projectId, title: 'Done', statusId: done.id, date: '2026-11-08', startMin: 600 })
  expect(scheduled.statusId).toBe(done.id)
  expect(scheduled.completedAt).not.toBeNull()
})

it('keeps the status when the workflow has no doing category', async () => {
  const { projectId, workflow, todo } = await setup()
  await db.workflows.update(workflow.id, { statuses: workflow.statuses.filter((s) => s.category !== 'doing') })
  const issue = await createIssue({ projectId, title: 'Task' })
  expect((await updateIssue(issue.id, { date: '2026-11-08', startMin: 600 })).statusId).toBe(todo.id)
})
