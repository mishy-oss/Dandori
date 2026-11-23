import { beforeEach, expect, it } from 'vitest'
import { db } from './db'
import { createProject, getWorkflow } from './projectRepo'
import { createIssue, deleteIssue, getIssue, moveIssue, updateIssue } from './issueRepo'
import { prepareMonthlyProject } from './monthlyRepo'

beforeEach(async () => {
  await Promise.all([db.projects.clear(), db.workflows.clear(), db.issues.clear(), db.recurrenceRules.clear(), db.monthlySnapshots.clear()])
})

async function setup() {
  const project = await createProject({ key: 'APP', name: 'App' })
  const workflow = (await getWorkflow(project.workflowId))!
  const todo = workflow.statuses.find((s) => s.category === 'todo')!.id
  const doing = workflow.statuses.find((s) => s.category === 'doing')!.id
  const done = workflow.statuses.find((s) => s.category === 'done')!.id
  const root = await createIssue({ projectId: project.id, title: 'Root' })
  const parent = await createIssue({ projectId: project.id, title: 'Parent', parentId: root.id })
  const a = await createIssue({ projectId: project.id, title: 'A', parentId: parent.id })
  const b = await createIssue({ projectId: project.id, title: 'B', parentId: parent.id })
  return { projectId: project.id, root, parent, a, b, todo, doing, done }
}

it('rolls up child progress through ancestors for edits and board moves', async () => {
  const { root, parent, a, b, todo, doing, done } = await setup()
  await updateIssue(a.id, { statusId: done })
  expect((await getIssue(parent.id))?.statusId).toBe(doing)
  expect((await getIssue(root.id))?.statusId).toBe(doing)
  await moveIssue(b.id, done, 0)
  const completedAt = (await getIssue(parent.id))?.completedAt
  expect(completedAt).not.toBeNull()
  expect((await getIssue(root.id))?.statusId).toBe(done)
  await updateIssue(b.id, { title: 'Renamed' })
  expect((await getIssue(parent.id))?.completedAt).toBe(completedAt)
  await updateIssue(a.id, { statusId: todo })
  expect(await getIssue(parent.id)).toMatchObject({ statusId: doing, completedAt: null })
  await moveIssue(b.id, todo, 0)
  expect(await getIssue(root.id)).toMatchObject({ statusId: todo, completedAt: null })
})

it('rolls up scheduling changes without copying schedules to the parent', async () => {
  const { parent, a, doing, todo } = await setup()
  await updateIssue(a.id, { date: '2026-11-08', startMin: 600 })
  expect(await getIssue(parent.id)).toMatchObject({ statusId: doing, date: null, startMin: null })
  await updateIssue(a.id, { startMin: null })
  expect((await getIssue(parent.id))?.statusId).toBe(todo)
})

it('updates both families when children are added, reparented and deleted', async () => {
  const { projectId, parent, a, b, doing, done, todo } = await setup()
  await updateIssue(a.id, { statusId: done })
  await updateIssue(b.id, { statusId: done })
  const newChild = await createIssue({ projectId, title: 'New', parentId: parent.id })
  expect((await getIssue(parent.id))?.statusId).toBe(doing)
  const other = await createIssue({ projectId, title: 'Other' })
  await createIssue({ projectId, title: 'Other todo', parentId: other.id })
  await updateIssue(newChild.id, { parentId: other.id })
  expect((await getIssue(parent.id))?.statusId).toBe(done)
  expect((await getIssue(other.id))?.statusId).toBe(todo)
  await updateIssue(a.id, { parentId: other.id })
  expect((await getIssue(other.id))?.statusId).toBe(doing)
  await deleteIssue(a.id)
  expect((await getIssue(other.id))?.statusId).toBe(todo)
})

it('uses child progress when a parent is edited directly', async () => {
  const { parent, a, todo, doing, done } = await setup()
  expect((await updateIssue(parent.id, { statusId: done })).statusId).toBe(todo)
  await updateIssue(a.id, { statusId: doing })
  expect((await moveIssue(parent.id, done, 0)).statusId).toBe(doing)
})

it.each(['edit', 'move'] as const)('completes a recurring child exactly once through %s and includes its next occurrence in parent progress', async (action) => {
  const { projectId, parent, a, b, doing, done } = await setup()
  await updateIssue(a.id, { statusId: done })
  await updateIssue(b.id, { statusId: done })
  const recurring = await createIssue({
    projectId, parentId: parent.id, title: 'Daily', date: '2026-11-08',
    recurrence: { frequency: 'daily', interval: 1 },
  })
  const complete = () => action === 'edit'
    ? updateIssue(recurring.id, { statusId: done })
    : moveIssue(recurring.id, done, 0)

  expect((await complete()).statusId).toBe(done)
  await complete()
  const occurrences = await db.issues.where('recurrenceId').equals(recurring.recurrenceId!).toArray()
  expect(occurrences).toHaveLength(2)
  expect(occurrences.find(issue => issue.id !== recurring.id)).toMatchObject({
    date: '2026-11-09', parentId: parent.id, completedAt: null,
  })
  expect(await getIssue(parent.id)).toMatchObject({ statusId: doing, completedAt: null })
})

it('repairs existing parent statuses on reload', async () => {
  const { projectId, parent, root, a, b, done } = await setup()
  await db.issues.update(a.id, { statusId: done, completedAt: 1 })
  await db.issues.update(b.id, { statusId: done, completedAt: 1 })
  await prepareMonthlyProject(projectId, '2026-11', '2026-11-08')
  expect((await getIssue(parent.id))?.statusId).toBe(done)
  expect((await getIssue(root.id))?.statusId).toBe(done)
})

it('detaches a child without deleting its work or descendants and recalculates the former family', async () => {
  const { projectId, root, parent, a, b, doing, done, todo } = await setup()
  const grandchild = await createIssue({ projectId, title: 'Grandchild', parentId: a.id })
  await updateIssue(b.id, { statusId: done })
  await updateIssue(a.id, { description: '説明は残す', labels: ['仕事'], priority: 'high', date: '2026-11-19', startMin: 600, durationMin: 45 })
  const before = (await getIssue(a.id))!
  expect((await getIssue(parent.id))?.statusId).toBe(doing)
  await updateIssue(a.id, { parentId: null })
  const after = (await getIssue(a.id))!
  expect({ ...after, updatedAt: before.updatedAt }).toEqual({ ...before, parentId: null })
  expect(await getIssue(grandchild.id)).toMatchObject({ parentId: a.id, deletedAt: null })
  expect((await getIssue(parent.id))?.statusId).toBe(done)
  expect((await getIssue(root.id))?.statusId).toBe(done)
  await updateIssue(grandchild.id, { statusId: done })
  await updateIssue(b.id, { statusId: todo })
  expect((await getIssue(parent.id))?.statusId).toBe(todo)
  expect((await getIssue(a.id))?.statusId).toBe(done)
  await deleteIssue(parent.id)
  expect(await getIssue(a.id)).toBeDefined()
  expect(await getIssue(grandchild.id)).toBeDefined()
})

it('preserves the last parent state after the final child is detached and permits manual progress', async () => {
  const { parent, a, b, doing, done } = await setup()
  await updateIssue(a.id, { statusId: doing })
  await updateIssue(b.id, { parentId: null })
  await updateIssue(a.id, { parentId: null })
  expect((await getIssue(parent.id))?.statusId).toBe(doing)
  await updateIssue(parent.id, { statusId: done })
  expect((await getIssue(parent.id))?.statusId).toBe(done)
  expect(await getIssue(a.id)).toMatchObject({ parentId: null, statusId: doing, deletedAt: null })
  expect(await getIssue(b.id)).toMatchObject({ parentId: null, deletedAt: null })
})
