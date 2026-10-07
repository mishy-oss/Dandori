import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import {
  createIssue,
  deleteIssue,
  getIssue,
  listIssues,
  moveIssue,
  updateIssue,
} from './issueRepo'
import {
  createProject,
  deleteProject,
  getWorkflow,
  listProjects,
  updateProject,
  updateWorkflowStatuses,
} from './projectRepo'

beforeEach(async () => {
  await Promise.all([db.projects.clear(), db.workflows.clear(), db.issues.clear()])
})

describe('project / workflow', () => {
  it('creates a project with a default workflow', async () => {
    const p = await createProject({ key: 'app', name: ' App ' })
    expect(p.key).toBe('APP')
    expect(p.name).toBe('App')
    expect(p.nextNumber).toBe(1)
    const w = await getWorkflow(p.workflowId)
    expect(w?.statuses.map((s) => s.category)).toEqual(['todo', 'doing', 'done'])
    expect(w?.statuses[1].wipLimit).toBe(3)
  })

  it('rejects invalid or duplicate keys and empty names', async () => {
    await createProject({ key: 'APP', name: 'App' })
    await expect(createProject({ key: 'APP', name: 'Dup' })).rejects.toThrow()
    await expect(createProject({ key: '1A', name: 'x' })).rejects.toThrow()
    await expect(createProject({ key: 'OK', name: '  ' })).rejects.toThrow()
  })

  it('updates name/color and soft-deletes with its issues', async () => {
    const p = await createProject({ key: 'APP', name: 'App' })
    await updateProject(p.id, { name: 'Renamed', color: '#fff' })
    expect((await listProjects())[0]).toMatchObject({ name: 'Renamed', color: '#fff' })

    await createIssue({ projectId: p.id, title: 'a' })
    await deleteProject(p.id)
    expect(await listProjects()).toEqual([])
    expect(await listIssues(p.id)).toEqual([])
    expect(await getWorkflow(p.workflowId)).toBeUndefined()
    // 論理削除なので実体は残る
    expect(await db.projects.count()).toBe(1)
  })

  it('allows reusing the key of a deleted project', async () => {
    const p = await createProject({ key: 'APP', name: 'App' })
    await deleteProject(p.id)
    await expect(createProject({ key: 'APP', name: 'New' })).resolves.toBeTruthy()
  })

  it('validates workflow edits', async () => {
    const p = await createProject({ key: 'APP', name: 'App' })
    const w = (await getWorkflow(p.workflowId))!
    const [todo, doing, done] = w.statuses

    const issue = await createIssue({ projectId: p.id, title: 'a', statusId: doing.id })

    await expect(updateWorkflowStatuses(w.id, [todo, doing])).rejects.toThrow()
    await expect(updateWorkflowStatuses(w.id, [todo, done])).rejects.toThrow()

    const renamed = await updateWorkflowStatuses(w.id, [
      todo,
      { ...doing, name: 'Doing' },
      done,
    ])
    expect(renamed.statuses[1].name).toBe('Doing')
    expect((await getIssue(issue.id))?.statusId).toBe(doing.id)
  })
})

describe('issue', () => {
  it('numbers issues per project and ranks them in order', async () => {
    const a = await createProject({ key: 'AAA', name: 'A' })
    const b = await createProject({ key: 'BBB', name: 'B' })
    const i1 = await createIssue({ projectId: a.id, title: 'one' })
    const i2 = await createIssue({ projectId: a.id, title: 'two' })
    const j1 = await createIssue({ projectId: b.id, title: 'other' })
    expect([i1.number, i2.number, j1.number]).toEqual([1, 2, 1])
    expect(i1.rank < i2.rank).toBe(true)
    expect((await listIssues(a.id)).map((i) => i.title)).toEqual(['one', 'two'])
  })

  it('creates with defaults from the design model', async () => {
    const p = await createProject({ key: 'APP', name: 'App' })
    const w = (await getWorkflow(p.workflowId))!
    const i = await createIssue({ projectId: p.id, title: 't' })
    expect(i).toMatchObject({
      type: 'task',
      priority: 'medium',
      statusId: w.statuses[0].id,
      durationMin: 30,
      date: null,
      startMin: null,
      assigneeId: null,
      completedAt: null,
      deletedAt: null,
    })
    expect(i.id).toHaveLength(26)
  })

  it('sets completedAt when moved to a done status and keeps the schedule', async () => {
    const p = await createProject({ key: 'APP', name: 'App' })
    const w = (await getWorkflow(p.workflowId))!
    const i = await createIssue({ projectId: p.id, title: 't' })
    await updateIssue(i.id, { date: '2026-10-07', startMin: 600 })

    const done = await updateIssue(i.id, { statusId: w.statuses[2].id })
    expect(done.completedAt).not.toBeNull()
    expect(done).toMatchObject({ date: '2026-10-07', startMin: 600 })

    const reopened = await updateIssue(i.id, { statusId: w.statuses[0].id })
    expect(reopened.completedAt).toBeNull()
  })

  it('rejects invalid input', async () => {
    const p = await createProject({ key: 'APP', name: 'App' })
    const i = await createIssue({ projectId: p.id, title: 't' })
    await expect(createIssue({ projectId: p.id, title: ' ' })).rejects.toThrow()
    await expect(createIssue({ projectId: 'nope', title: 'x' })).rejects.toThrow()
    await expect(
      createIssue({ projectId: p.id, title: 'x', statusId: 'bad' }),
    ).rejects.toThrow()
    await expect(updateIssue(i.id, { title: '' })).rejects.toThrow()
    await expect(updateIssue(i.id, { statusId: 'bad' })).rejects.toThrow()
    await expect(updateIssue(i.id, { parentId: i.id })).rejects.toThrow()
    await expect(updateIssue('nope', { title: 'x' })).rejects.toThrow()
  })

  it('soft-deletes an issue together with its descendants', async () => {
    const p = await createProject({ key: 'APP', name: 'App' })
    const epic = await createIssue({ projectId: p.id, title: 'epic', type: 'epic' })
    const sub = await createIssue({ projectId: p.id, title: 'sub', parentId: epic.id })
    const subsub = await createIssue({ projectId: p.id, title: 'subsub', parentId: sub.id })
    const other = await createIssue({ projectId: p.id, title: 'other' })

    await deleteIssue(epic.id)
    expect((await listIssues(p.id)).map((i) => i.id)).toEqual([other.id])
    expect(await getIssue(subsub.id)).toBeUndefined()
    expect(await db.issues.count()).toBe(4)
  })
})

describe('moveIssue', () => {
  async function setup() {
    const p = await createProject({ key: 'APP', name: 'App' })
    const [todo, doing, done] = (await getWorkflow(p.workflowId))!.statuses
    const a = await createIssue({ projectId: p.id, title: 'a' })
    const b = await createIssue({ projectId: p.id, title: 'b' })
    const c = await createIssue({ projectId: p.id, title: 'c' })
    return { p, todo, doing, done, a, b, c }
  }
  const titles = async (projectId: string, statusId: string) =>
    (await listIssues(projectId)).filter((i) => i.statusId === statusId).map((i) => i.title)

  it('reorders within a column', async () => {
    const { p, todo, a, b, c } = await setup()
    await moveIssue(c.id, todo.id, 0)
    expect(await titles(p.id, todo.id)).toEqual(['c', 'a', 'b'])
    await moveIssue(a.id, todo.id, 2)
    expect(await titles(p.id, todo.id)).toEqual(['c', 'b', 'a'])
    await moveIssue(b.id, todo.id, 99)
    expect(await titles(p.id, todo.id)).toEqual(['c', 'a', 'b'])
  })

  it('moves across columns and manages completedAt and schedule', async () => {
    const { p, todo, doing, done, a, b } = await setup()
    await updateIssue(a.id, { date: '2026-10-07', startMin: 540 })

    await moveIssue(a.id, doing.id, 0)
    await moveIssue(b.id, doing.id, 0)
    expect(await titles(p.id, doing.id)).toEqual(['b', 'a'])
    expect(await titles(p.id, todo.id)).toEqual(['c'])

    const d = await moveIssue(a.id, done.id, 0)
    expect(d.completedAt).not.toBeNull()
    expect(d).toMatchObject({ date: '2026-10-07', startMin: 540 })

    const stamp = d.completedAt
    expect((await moveIssue(a.id, done.id, 0)).completedAt).toBe(stamp)
    expect((await moveIssue(a.id, todo.id, 0)).completedAt).toBeNull()
  })

  it('repairs colliding ranks in a column', async () => {
    const { p, todo, a, b, c } = await setup()
    await db.issues.bulkUpdate([a, b, c].map((i) => ({ key: i.id, changes: { rank: 'a0' } })))
    await moveIssue(c.id, todo.id, 1)
    const ranks = (await listIssues(p.id)).map((i) => i.rank)
    expect(new Set(ranks).size).toBe(3)
    const column = await titles(p.id, todo.id)
    expect(column).toHaveLength(3)
    expect(column[1]).toBe('c')
  })

  it('rejects unknown issues and statuses', async () => {
    const { todo, a } = await setup()
    await expect(moveIssue('nope', todo.id, 0)).rejects.toThrow()
    await expect(moveIssue(a.id, 'bad', 0)).rejects.toThrow()
  })
})
