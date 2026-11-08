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

beforeEach(/* 各テストの前に使用するDBテーブルを空にし、以前のテストの保存データが結果へ影響しないようにする。 */ async () => {
  await Promise.all([
    db.projects.clear(),
    db.workflows.clear(),
    db.issues.clear(),
    db.sprints.clear(),
  ])
})

/** スプリント操作テスト用にプロジェクトと初期ステータスを用意する。 */
async function setup() {
  const p = await createProject({ key: 'APP', name: 'App' })
  const [todo, doing, done] = (await getWorkflow(p.workflowId))!.statuses
  return { p, todo, doing, done }
}

describe('createSprint / updateSprint', /* 「createSprint / updateSprint」に関するテストをまとめて定義する。 */ () => {
  it('defaults to a two-week period and numbered name', /* スプリントの既定期間が14日間で、名前に連番が付くことを検証する。 */ async () => {
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

  it('validates period, name and project', /* 前後関係が不正な期間、無効な日付、空の名前、不明なプロジェクトを拒否することを検証する。 */ async () => {
    const { p } = await setup()
    await expect(createSprint(p.id, { startDate: '2026-10-10', endDate: '2026-10-01' })).rejects.toThrow()
    await expect(createSprint(p.id, { startDate: 'bad' })).rejects.toThrow()
    await expect(createSprint(p.id, { name: '  ' })).rejects.toThrow()
    await expect(createSprint('nope')).rejects.toThrow()
  })

  it('updates planned/active sprints but not closed ones', /* 計画中のスプリントを編集でき、期間の矛盾や完了後の編集を拒否することを検証する。 */ async () => {
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

describe('startSprint', /* 「startSprint」に関するテストをまとめて定義する。 */ () => {
  it('requires issues and allows only one active sprint', /* 空のスプリントは開始できず、同時にアクティブにできるのは1つだけであることを検証する。 */ async () => {
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

describe('completeSprint', /* 「completeSprint」に関するテストをまとめて定義する。 */ () => {
  /** 未完了・進行中・完了のIssueを含むスプリントを開始し、持ち越しテストの前提を用意する。 */
  async function active() {
    const ctx = await setup()
    const s = await createSprint(ctx.p.id, { startDate: '2026-10-01', endDate: '2026-10-14' }, TODAY)
    const open = await createIssue({ projectId: ctx.p.id, title: 'open', sprintId: s.id })
    const doing = await createIssue({ projectId: ctx.p.id, title: 'doing', sprintId: s.id, statusId: ctx.doing.id })
    const done = await createIssue({ projectId: ctx.p.id, title: 'done', sprintId: s.id, statusId: ctx.done.id })
    await startSprint(s.id)
    return { ...ctx, s, open, doing, done }
  }

  it('sends incomplete issues back to the backlog and keeps done ones', /* 完了処理で未完了Issueだけをバックログへ戻し、完了Issueを元のスプリントに残すことを検証する。 */ async () => {
    const { s, open, doing, done } = await active()
    const r = await completeSprint(s.id, { to: 'backlog' }, TODAY)
    expect(r).toEqual({ doneCount: 1, movedCount: 2, nextSprintId: null })
    expect((await getIssue(open.id))?.sprintId).toBeNull()
    expect((await getIssue(doing.id))?.sprintId).toBeNull()
    expect((await getIssue(done.id))?.sprintId).toBe(s.id)
    expect((await listSprints(s.projectId))[0].state).toBe('closed')
  })

  it('carries incomplete issues to an existing planned sprint', /* 未完了Issueを選択した計画中スプリントへ持ち越せることを検証する。 */ async () => {
    const { p, s, open, doing } = await active()
    const next = await createSprint(p.id, {}, TODAY)
    const r = await completeSprint(s.id, { to: 'sprint', sprintId: next.id }, TODAY)
    expect(r.nextSprintId).toBe(next.id)
    expect((await getIssue(open.id))?.sprintId).toBe(next.id)
    expect((await getIssue(doing.id))?.sprintId).toBe(next.id)
  })

  it('creates a new sprint with the same length after the old one', /* 元のスプリントの翌日から同じ長さの新規スプリントを作り、未完了分を持ち越すことを検証する。 */ async () => {
    const { p, s, open } = await active()
    const r = await completeSprint(s.id, { to: 'new' }, '2026-10-07')
    const created = (await listSprints(p.id)).find(/* 指定IDと一致という条件を最初に満たす要素を探す。 */ (x) => x.id === r.nextSprintId)!
    expect(created).toMatchObject({ state: 'planned', startDate: '2026-10-15', endDate: '2026-10-28' })
    expect((await getIssue(open.id))?.sprintId).toBe(created.id)
  })

  it('starts the new sprint today when the old one ended long ago', /* 元のスプリントが過去に終わっていれば、新規スプリントを今日から始めることを検証する。 */ async () => {
    const { p, s } = await active()
    const r = await completeSprint(s.id, { to: 'new' }, '2026-12-01')
    const created = (await listSprints(p.id)).find(/* 指定IDと一致という条件を最初に満たす要素を探す。 */ (x) => x.id === r.nextSprintId)!
    expect(created).toMatchObject({ startDate: '2026-12-01', endDate: '2026-12-14' })
  })

  it('rejects invalid targets and non-active sprints', /* アクティブ以外の完了処理や不正な持ち越し先を拒否し、元の状態が残ることを検証する。 */ async () => {
    const { p, s } = await active()
    const planned = await createSprint(p.id, {}, TODAY)
    await expect(completeSprint(planned.id, { to: 'backlog' })).rejects.toThrow()
    await expect(completeSprint(s.id, { to: 'sprint', sprintId: s.id })).rejects.toThrow()
    await expect(completeSprint(s.id, { to: 'sprint', sprintId: 'nope' })).rejects.toThrow()
    expect((await listSprints(p.id)).find(/* 指定IDと一致という条件を最初に満たす要素を探す。 */ (x) => x.id === s.id)?.state).toBe('active')
  })

  it('does not require an action target when everything is done', /* 全Issueが完了済みなら、実際の持ち越し先を必要とせず完了できることを検証する。 */ async () => {
    const { p, done } = await setup()
    const s = await createSprint(p.id, {}, TODAY)
    await createIssue({ projectId: p.id, title: 'x', sprintId: s.id, statusId: done.id })
    await startSprint(s.id)
    const r = await completeSprint(s.id, { to: 'sprint', sprintId: 'ignored' }, TODAY)
    expect(r).toEqual({ doneCount: 1, movedCount: 0, nextSprintId: null })
  })
})

describe('deleteSprint / assignIssueToSprint', /* 「deleteSprint / assignIssueToSprint」に関するテストをまとめて定義する。 */ () => {
  it('moves issues to and from sprints, but not into closed ones', /* Issueをスプリントとバックログの間で移せる一方、完了済みスプリントへの追加は拒否することを検証する。 */ async () => {
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

  it('deletes only planned sprints and returns their issues to the backlog', /* 計画中のスプリントだけを削除でき、所属Issueがバックログへ戻ることを検証する。 */ async () => {
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

  it('soft-deletes sprints with their project', /* プロジェクトの論理削除に伴い、関連スプリントも一覧から消えることを検証する。 */ async () => {
    const { p } = await setup()
    await createSprint(p.id, {}, TODAY)
    await deleteProject(p.id)
    expect(await listSprints(p.id)).toEqual([])
  })
})

describe('moveIssue with a sprint scope', /* 「moveIssue with a sprint scope」に関するテストをまとめて定義する。 */ () => {
  it('interprets the index within the visible sprint only', /* 非表示のバックログIssueを並び替えの位置に数えず、対象スプリント内の順序で移動できることを検証する。 */ async () => {
    const { p, todo } = await setup()
    const s = await createSprint(p.id, {}, TODAY)
    const hidden1 = await createIssue({ projectId: p.id, title: 'h1' })
    await createIssue({ projectId: p.id, title: 'a', sprintId: s.id })
    const hidden2 = await createIssue({ projectId: p.id, title: 'h2' })
    await createIssue({ projectId: p.id, title: 'b', sprintId: s.id })
    const c = await createIssue({ projectId: p.id, title: 'c', sprintId: s.id })

    await moveIssue(c.id, todo.id, 0, s.id)
    const order = (await listIssues(p.id)).filter(/* 指定スプリントまたはバックログと一致という条件を満たす要素だけを残す。 */ (i) => i.sprintId === s.id).map(/* 各要素からタイトルだけを取り出す。 */ (i) => i.title)
    expect(order).toEqual(['c', 'a', 'b'])
    expect([hidden1, hidden2].every(/* 対象外だったIssueがすべてバックログ所属のまま残っているかを確認する。 */ (h) => h.sprintId === null)).toBe(true)
  })
})
