import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { createIssue, getIssue, listIssues, moveIssue, updateIssue } from './issueRepo'
import { createProject, deleteProject, getWorkflow } from './projectRepo'
import {
  assignIssueToSprint,
  completeSprint,
  createSprint,
  deleteSprint,
  listSprints,
  startSprint,
  updateSprint,
} from './sprintRepo'

const TODAY = '2026-10-07'

beforeEach(async () => {
  await Promise.all([
    db.projects.clear(),
    db.workflows.clear(),
    db.issues.clear(),
    db.sprints.clear(),
  ])
})

async function setup() {
  const p = await createProject({ key: 'APP', name: 'App' })
  const [todo, doing, done] = (await getWorkflow(p.workflowId))!.statuses
  return { p, todo, doing, done }
}

describe('createSprint / updateSprint', () => {
  it('defaults to a two-week period and numbered name', async () => {
    const { p } = await setup()
    const s1 = await createSprint(p.id, {}, TODAY)
    const s2 = await createSprint(p.id, { goal: ' goal ' }, TODAY)
    expect(s1).toMatchObject({
      name: 'Sprint 1',
      startDate: '2026-10-07',
      endDate: '2026-10-20',
      state: 'planned',
      snapshots: [],
    })
    expect(s2.name).toBe('Sprint 2')
    expect(s2.goal).toBe('goal')
  })

  it('validates period, name and project', async () => {
    const { p } = await setup()
    await expect(createSprint(p.id, { startDate: '2026-10-10', endDate: '2026-10-01' })).rejects.toThrow()
    await expect(createSprint(p.id, { startDate: 'bad' })).rejects.toThrow()
    await expect(createSprint(p.id, { name: '  ' })).rejects.toThrow()
    await expect(createSprint('nope')).rejects.toThrow()
  })

  it('updates planned/active sprints but not closed ones', async () => {
    const { p } = await setup()
    const s = await createSprint(p.id, {}, TODAY)
    const u = await updateSprint(s.id, { name: 'X', endDate: '2026-10-31', goal: '' })
    expect(u).toMatchObject({ name: 'X', endDate: '2026-10-31', goal: undefined })
    await expect(updateSprint(s.id, { endDate: '2026-01-01' })).rejects.toThrow()

    await createIssue({ projectId: p.id, title: 'a', sprintId: s.id })
    await startSprint(s.id)
    await completeSprint(s.id, { to: 'backlog' }, TODAY)
    await expect(updateSprint(s.id, { name: 'Y' })).rejects.toThrow()
  })
})

describe('startSprint', () => {
  it('requires issues and allows only one active sprint', async () => {
    const { p } = await setup()
    const a = await createSprint(p.id, {}, TODAY)
    const b = await createSprint(p.id, {}, TODAY)
    await expect(startSprint(a.id)).rejects.toThrow()

    await createIssue({ projectId: p.id, title: '1', sprintId: a.id })
    await createIssue({ projectId: p.id, title: '2', sprintId: b.id })
    expect((await startSprint(a.id)).state).toBe('active')
    await expect(startSprint(b.id)).rejects.toThrow()
    await expect(startSprint(a.id)).rejects.toThrow()
  })
})

describe('completeSprint', () => {
  async function active() {
    const ctx = await setup()
    const s = await createSprint(ctx.p.id, { startDate: '2026-10-01', endDate: '2026-10-14' }, TODAY)
    const open = await createIssue({ projectId: ctx.p.id, title: 'open', sprintId: s.id })
    const doing = await createIssue({ projectId: ctx.p.id, title: 'doing', sprintId: s.id, statusId: ctx.doing.id })
    const done = await createIssue({ projectId: ctx.p.id, title: 'done', sprintId: s.id, statusId: ctx.done.id })
    await startSprint(s.id)
    return { ...ctx, s, open, doing, done }
  }

  it('sends incomplete issues back to the backlog and keeps done ones', async () => {
    const { s, open, doing, done } = await active()
    const r = await completeSprint(s.id, { to: 'backlog' }, TODAY)
    expect(r).toEqual({ doneCount: 1, movedCount: 2, nextSprintId: null })
    expect((await getIssue(open.id))?.sprintId).toBeNull()
    expect((await getIssue(doing.id))?.sprintId).toBeNull()
    expect((await getIssue(done.id))?.sprintId).toBe(s.id)
    expect((await listSprints(s.projectId))[0].state).toBe('closed')
  })

  it('carries incomplete issues to an existing planned sprint', async () => {
    const { p, s, open, doing } = await active()
    const next = await createSprint(p.id, {}, TODAY)
    const r = await completeSprint(s.id, { to: 'sprint', sprintId: next.id }, TODAY)
    expect(r.nextSprintId).toBe(next.id)
    expect((await getIssue(open.id))?.sprintId).toBe(next.id)
    expect((await getIssue(doing.id))?.sprintId).toBe(next.id)
  })

  it('creates a new sprint with the same length after the old one', async () => {
    const { p, s, open } = await active()
    const r = await completeSprint(s.id, { to: 'new' }, '2026-10-07')
    const created = (await listSprints(p.id)).find((x) => x.id === r.nextSprintId)!
    expect(created).toMatchObject({ state: 'planned', startDate: '2026-10-15', endDate: '2026-10-28' })
    expect((await getIssue(open.id))?.sprintId).toBe(created.id)
  })

  it('starts the new sprint today when the old one ended long ago', async () => {
    const { p, s } = await active()
    const r = await completeSprint(s.id, { to: 'new' }, '2026-12-01')
    const created = (await listSprints(p.id)).find((x) => x.id === r.nextSprintId)!
    expect(created).toMatchObject({ startDate: '2026-12-01', endDate: '2026-12-14' })
  })

  it('rejects invalid targets and non-active sprints', async () => {
    const { p, s } = await active()
    const planned = await createSprint(p.id, {}, TODAY)
    await expect(completeSprint(planned.id, { to: 'backlog' })).rejects.toThrow()
    await expect(completeSprint(s.id, { to: 'sprint', sprintId: s.id })).rejects.toThrow()
    await expect(completeSprint(s.id, { to: 'sprint', sprintId: 'nope' })).rejects.toThrow()
    expect((await listSprints(p.id)).find((x) => x.id === s.id)?.state).toBe('active')
  })

  it('does not require an action target when everything is done', async () => {
    const { p, done } = await setup()
    const s = await createSprint(p.id, {}, TODAY)
    await createIssue({ projectId: p.id, title: 'x', sprintId: s.id, statusId: done.id })
    await startSprint(s.id)
    const r = await completeSprint(s.id, { to: 'sprint', sprintId: 'ignored' }, TODAY)
    expect(r).toEqual({ doneCount: 1, movedCount: 0, nextSprintId: null })
  })
})

describe('deleteSprint / assignIssueToSprint', () => {
  it('moves issues to and from sprints, but not into closed ones', async () => {
    const { p, done } = await setup()
    const s = await createSprint(p.id, {}, TODAY)
    const i = await createIssue({ projectId: p.id, title: 'a' })
    expect((await assignIssueToSprint(i.id, s.id)).sprintId).toBe(s.id)
    expect((await assignIssueToSprint(i.id, null)).sprintId).toBeNull()
    await expect(assignIssueToSprint(i.id, 'nope')).rejects.toThrow()
    await expect(assignIssueToSprint('nope', null)).rejects.toThrow()

    await updateIssue(i.id, { statusId: done.id })
    await assignIssueToSprint(i.id, s.id)
    await startSprint(s.id)
    await completeSprint(s.id, { to: 'backlog' }, TODAY)
    await expect(assignIssueToSprint(i.id, s.id)).rejects.toThrow()
    await expect(createIssue({ projectId: p.id, title: 'b', sprintId: s.id })).rejects.toThrow()
  })

  it('deletes only planned sprints and returns their issues to the backlog', async () => {
    const { p } = await setup()
    const s = await createSprint(p.id, {}, TODAY)
    const i = await createIssue({ projectId: p.id, title: 'a', sprintId: s.id })
    await deleteSprint(s.id)
    expect(await listSprints(p.id)).toEqual([])
    expect((await getIssue(i.id))?.sprintId).toBeNull()

    const t = await createSprint(p.id, {}, TODAY)
    await assignIssueToSprint(i.id, t.id)
    await startSprint(t.id)
    await expect(deleteSprint(t.id)).rejects.toThrow()
  })

  it('soft-deletes sprints with their project', async () => {
    const { p } = await setup()
    await createSprint(p.id, {}, TODAY)
    await deleteProject(p.id)
    expect(await listSprints(p.id)).toEqual([])
  })
})

describe('moveIssue with a sprint scope', () => {
  it('interprets the index within the visible sprint only', async () => {
    const { p, todo } = await setup()
    const s = await createSprint(p.id, {}, TODAY)
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
