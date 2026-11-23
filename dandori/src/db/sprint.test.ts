import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { createIssue, listIssues, moveIssue } from './issueRepo'
import { createProject, deleteProject, getWorkflow } from './projectRepo'
import { getSprint } from './sprintRepo'
import { insertLegacySprint } from '../test/legacySprint'

beforeEach(async () => {
  await Promise.all([db.projects.clear(), db.workflows.clear(), db.issues.clear(), db.sprints.clear()])
})

it('soft-deletes legacy sprints with their project', async () => {
  const project = await createProject({ key: 'APP', name: 'App' })
  const sprint = await insertLegacySprint(project.id, '2026-10-07', '2026-10-20')
  expect(await getSprint(sprint.id)).toEqual(sprint)

  await deleteProject(project.id)
  expect(await getSprint(sprint.id)).toBeUndefined()
  expect((await db.sprints.get(sprint.id))?.deletedAt).toBeTypeOf('number')
})

describe('moveIssue with a sprint scope', () => {
  it('interprets the index within the visible sprint only', async () => {
    const p = await createProject({ key: 'APP', name: 'App' })
    const todo = (await getWorkflow(p.workflowId))!.statuses.find(status => status.category === 'todo')!
    const s = await insertLegacySprint(p.id, '2026-10-07', '2026-10-20')
    const hidden1 = await createIssue({ projectId: p.id, title: 'h1' })
    await createIssue({ projectId: p.id, title: 'a', sprintId: s.id })
    const hidden2 = await createIssue({ projectId: p.id, title: 'h2' })
    await createIssue({ projectId: p.id, title: 'b', sprintId: s.id })
    const c = await createIssue({ projectId: p.id, title: 'c', sprintId: s.id })

    await moveIssue(c.id, todo.id, 0, s.id)
    const order = (await listIssues(p.id)).filter((i) => i.sprintId === s.id).map((i) => i.title)
    expect(order).toEqual(['c', 'a', 'b'])
    expect([hidden1, hidden2].every((h) => h.sprintId === null)).toBe(true)
  })
})
